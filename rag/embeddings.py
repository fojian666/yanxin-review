"""嵌入（向量）后端：只负责「文本 → 向量」，检索策略留在 retrieval.py。

三个后端，按 `EMBED_BACKEND` 选择：

- `local`：进程内跑 sentence-transformers（模型放 `models/`，不进仓库）；
- `api`：OpenAI 兼容的 /embeddings（默认 SiliconFlow 的 BAAI/bge-m3）；
- `none`：不使用向量，检索退回纯 TF-IDF。

`auto`（默认）按 本地 → API → none 的顺序挑第一个可用的；运行期本地加载失败会自动改走 API。

安全：`api` 会把待检索文本发往端点，等同于一次数据出内网。公网端点必须显式
`ALLOW_EXTERNAL_EMBED=1` 才放行，否则整体降级为 none（与 LLM 出口门禁同一口径）。
重定向一律拒绝跟随——否则一条 307 就能把请求体送到未校验的地址。

成本：向量按「单条文本 + 后端 + 端点 + 模型」哈希缓存到 `data/embed_cache/`，
新增一份文档只补算它自己的分块，不会整库重算。查询向量默认不落盘（`cache=False`），
否则每换一种问法就要重写一次缓存文件。
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from pathlib import Path

import numpy as np
import requests

from . import config

log = logging.getLogger("rag.embeddings")

ATTEMPTS = 3
BACKOFF = (0.3, 1.0)


class EmbeddingUnavailable(RuntimeError):
    """后端不可用（未配置 / 被门禁拦住 / 依赖缺失 / 调用失败）。"""


def _is_public(url: str) -> bool:
    return config._is_public_host(url)  # 与 LLM 出口门禁共用同一判定


class Embedder:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._local_model = None
        self._backend: str | None = None
        self._reason: str = ""
        self._auto = False
        self._store: dict[str, np.ndarray] | None = None
        self._store_ns = ""  # 缓存对应的命名空间；换后端/端点/模型要重新加载

    # ---------- 状态 ----------
    def status(self) -> dict:
        backend, reason = self._resolve()
        return {
            "backend": backend,
            "model": config.EMBED_MODEL if backend != "none" else "",
            "base_url": config.EMBED_BASE_URL if backend == "api" else "",
            "reason": reason,
            "enabled": backend != "none",
        }

    def _resolve(self) -> tuple[str, str]:
        """确定实际后端；结果缓存，避免每次检索都探测。"""
        with self._lock:
            if self._backend is not None:
                return self._backend, self._reason
            wanted = config.EMBED_BACKEND
            self._auto = wanted == "auto"
            backend, reason = "none", ""
            if wanted in {"none", "off", "0", "false"}:
                reason = "已关闭（EMBED_BACKEND=none）"
            else:
                candidates = ["local", "api"] if self._auto else [wanted]
                for name in candidates:
                    ok, why = self._probe(name)
                    if ok:
                        backend, reason = name, ""
                        break
                    reason = why
            self._backend, self._reason = backend, reason
            if backend != "none":
                log.info("嵌入后端：%s（%s）", backend, config.EMBED_MODEL)
            else:
                log.info("嵌入未启用，检索走纯 TF-IDF：%s", reason)
            return backend, reason

    def _probe(self, name: str) -> tuple[bool, str]:
        if name == "local":
            try:
                import sentence_transformers  # noqa: F401
            except Exception:
                return False, "未安装 sentence-transformers"
            # 只认可真实存在的本地目录：HF 仓库 id 会触发联网下载，不能当作「本地可用」
            if not Path(config.EMBED_MODEL).is_dir():
                return False, f"本地模型目录不存在：{config.EMBED_MODEL}"
            return True, ""
        if name == "api":
            if not config.EMBED_API_KEY:
                return False, "未配置 EMBED_API_KEY"
            if _is_public(config.EMBED_BASE_URL) and not config.ALLOW_EXTERNAL_EMBED:
                return False, "公网嵌入端点已阻止（需 ALLOW_EXTERNAL_EMBED=1）"
            return True, ""
        return False, f"未知后端 {name}"

    # ---------- 对外接口 ----------
    def embed(self, texts: list[str], cache: bool = True) -> np.ndarray:
        """返回 L2 归一化后的 (n, dim) float32 矩阵；不可用时抛 EmbeddingUnavailable。

        cache=False 用于查询向量：只算不存盘，避免每条新问法都重写整份缓存。
        """
        if isinstance(texts, str):
            raise TypeError("embed() 需要文本列表，不能传单个字符串")
        texts = [t or "" for t in texts]
        if not texts:
            return np.zeros((0, 0), dtype=np.float32)
        backend, reason = self._resolve()
        if backend == "none":
            raise EmbeddingUnavailable(reason or "嵌入后端不可用")

        if not cache:
            return self._normalize(self._call(backend, texts), len(texts))

        store = self._load_store()
        keys = [self._text_key(t) for t in texts]
        pending: dict[str, str] = {}
        for key, text in zip(keys, texts):
            if key not in store and key not in pending:
                pending[key] = text
        if pending:
            items = list(pending.items())
            vectors = self._normalize(
                self._call(backend, [text for _, text in items]), len(items)
            )
            dim = int(vectors.shape[1])
            if any(int(v.shape[0]) != dim for v in store.values()):
                # 同一命名空间下维度变了（端点换了实现）→ 旧条目全部作废，
                # 本次请求的文本整批重算，不能只补 pending 那几条
                log.info("嵌入缓存维度与当前模型不符，重建缓存")
                store.clear()
                vectors = self._normalize(self._call(backend, texts), len(texts))
                for key, vector in zip(keys, vectors):
                    store[key] = vector
            else:
                for (key, _), vector in zip(items, vectors):
                    store[key] = vector
            self._save_store()

        dims = {int(store[key].shape[0]) for key in keys}
        if len(dims) != 1:
            raise EmbeddingUnavailable(
                f"向量维度不一致（{sorted(dims)}），请删除 {config.EMBED_CACHE_DIR} 后重试"
            )
        return np.stack([store[key] for key in keys]).astype(np.float32)

    # ---------- 具体调用 ----------
    @staticmethod
    def _normalize(vectors, expected: int) -> np.ndarray:
        matrix = np.asarray(vectors, dtype=np.float32)
        if matrix.ndim != 2 or matrix.shape[0] != expected or matrix.shape[1] == 0:
            raise EmbeddingUnavailable(f"向量形状异常：{matrix.shape}，期望 ({expected}, dim)")
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return matrix / norms

    def _call(self, backend: str, texts: list[str]) -> list[list[float]]:
        if backend != "local":
            return self._api(texts)
        try:
            return self._local(texts)
        except Exception as exc:  # 本地模型可能因缺文件/显存不足失败
            if not self._auto:
                raise EmbeddingUnavailable(f"本地嵌入模型不可用：{exc}") from exc
            log.warning("本地嵌入模型不可用，改走 API：%s", exc)
            with self._lock:
                self._backend, self._reason = "api", ""
                self._store, self._store_ns = None, ""
            return self._api(texts)

    def _local(self, texts: list[str]) -> list[list[float]]:
        with self._lock:
            if self._local_model is None:
                from sentence_transformers import SentenceTransformer

                self._local_model = SentenceTransformer(config.EMBED_MODEL)
            vectors = self._local_model.encode(
                texts, batch_size=config.EMBED_BATCH, normalize_embeddings=True
            )
        return np.asarray(vectors, dtype=np.float32).tolist()

    def _api(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for start in range(0, len(texts), config.EMBED_BATCH):
            out.extend(self._api_batch(texts[start : start + config.EMBED_BATCH]))
        return out

    def _api_batch(self, batch: list[str]) -> list[list[float]]:
        payload = {"model": config.EMBED_MODEL, "input": batch, "encoding_format": "float"}
        last = ""
        for attempt in range(ATTEMPTS):
            retry_left = attempt < ATTEMPTS - 1
            try:
                resp = requests.post(
                    f"{config.EMBED_BASE_URL}/embeddings",
                    headers={
                        "Authorization": f"Bearer {config.EMBED_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=config.EMBED_TIMEOUT,
                    allow_redirects=False,  # 门禁只校验初始地址，跟随重定向等于绕过它
                )
            except requests.RequestException as exc:
                if retry_left:
                    time.sleep(BACKOFF[attempt])
                    last = str(exc)
                    continue
                raise EmbeddingUnavailable(f"嵌入接口调用失败：{exc}") from exc

            code = resp.status_code
            if 300 <= code < 400:
                raise EmbeddingUnavailable(f"嵌入端点返回重定向（HTTP {code}），已拒绝跟随")
            if code == 429 or code >= 500:
                if retry_left:
                    time.sleep(self._retry_after(resp, attempt))
                    last = f"HTTP {code}"
                    continue
                raise EmbeddingUnavailable(f"嵌入接口调用失败：HTTP {code}")
            if code >= 400:
                # 4xx 是鉴权/参数问题，重试只会放大风险
                raise EmbeddingUnavailable(f"嵌入接口拒绝请求：HTTP {code}")

            try:
                data = resp.json().get("data") or []
            except ValueError as exc:
                raise EmbeddingUnavailable(f"嵌入接口返回非 JSON：{exc}") from exc
            return self._place(batch, data)

        raise EmbeddingUnavailable(f"嵌入接口调用失败：{last or '未知错误'}")

    @staticmethod
    def _retry_after(resp, attempt: int) -> float:
        raw = (resp.headers.get("Retry-After") or "").strip()
        if raw.isdigit():
            return float(min(int(raw), 5))
        return BACKOFF[attempt]

    @staticmethod
    def _place(batch: list[str], data) -> list[list[float]]:
        """按响应里的 index 落位；服务端乱序返回也不会把向量挂到别的文本上。"""
        slots: list[list[float] | None] = [None] * len(batch)
        for pos, item in enumerate(data):
            if not isinstance(item, dict):
                raise EmbeddingUnavailable("嵌入接口返回结构异常")
            index = item.get("index", pos)
            vector = item.get("embedding")
            if not isinstance(index, int) or not 0 <= index < len(batch) or not vector:
                raise EmbeddingUnavailable("嵌入接口返回结构异常（index/embedding 无效）")
            slots[index] = vector
        if any(slot is None for slot in slots):
            raise EmbeddingUnavailable(
                f"返回条数不符：期望 {len(batch)}，实得 {sum(s is not None for s in slots)}"
            )
        return slots  # type: ignore[return-value]

    # ---------- 缓存 ----------
    def _namespace(self) -> str:
        backend = self._backend or "auto"
        base = config.EMBED_BASE_URL if backend != "local" else ""
        return f"{backend}|{base}|{config.EMBED_MODEL}"

    def _text_key(self, text: str) -> str:
        digest = hashlib.sha256()
        digest.update(self._namespace().encode("utf-8"))
        digest.update(b"\x00")
        digest.update(text.encode("utf-8", errors="surrogatepass"))
        return digest.hexdigest()[:24]

    def _store_path(self) -> Path | None:
        """按命名空间分文件，换后端/端点/模型不会读到旧向量。"""
        try:
            config.EMBED_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            log.info("嵌入缓存目录不可写，本次不落盘：%s", exc)
            return None
        tag = hashlib.sha1(self._namespace().encode("utf-8")).hexdigest()[:12]
        return config.EMBED_CACHE_DIR / f"vec-{tag}.npz"

    def _load_store(self) -> dict[str, np.ndarray]:
        with self._lock:
            ns = self._namespace()
            if self._store is not None and self._store_ns == ns:
                return self._store
            store: dict[str, np.ndarray] = {}
            path = self._store_path()
            if path is not None and path.exists():
                try:
                    with np.load(path) as data:
                        for name in data.files:
                            vector = np.asarray(data[name], dtype=np.float32)
                            if vector.ndim == 1 and vector.size:
                                store[name] = vector
                except Exception:  # 截断的 npz 抛 BadZipFile/EOFError，一律当作没有
                    store = {}
                    try:
                        path.unlink(missing_ok=True)  # 删掉坏文件，下次能重建
                    except OSError:
                        pass
            self._store, self._store_ns = store, ns
            return store

    def _save_store(self) -> None:
        with self._lock:
            store = self._store
            path = self._store_path() if store else None
            if path is None or not store:
                return
            # tmp 名带 pid+线程号：多 worker/多线程同时写不会互相截断
            tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
            try:
                with open(tmp, "wb") as fh:  # 传文件对象，避免 savez 给非 .npz 名再补后缀
                    np.savez_compressed(fh, **dict(store))
                tmp.replace(path)
                path.with_name(f"index-{path.stem}.json").write_text(
                    json.dumps(
                        {
                            "namespace": self._namespace(),
                            "model": config.EMBED_MODEL,
                            "backend": self._backend,
                            "texts": len(store),
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
            except (OSError, ValueError, RuntimeError):
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass  # 缓存是增强项，写不进去不影响本次结果


embedder = Embedder()
