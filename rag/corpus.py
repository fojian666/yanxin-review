"""公开政策语料入库：把 corpus/ 下的政策快照写入文档库（幂等）。

与 `tools/fetch_corpus.py` 的分工：

- `tools/fetch_corpus.py`：联网抓取公文原文 → `corpus/policy/*.txt` + `corpus/sources.json`；
- 本模块：离线入库 → `documents(kind='policy', source='public')` + `chunks`。

政策入库后，预审的「政策合规」环节会自动检索到真实条款，问答也能按文档范围
引用原文，不再输出「政策库未接入」。数据不出内网：快照是本地文件，运行时零联网。

用法：
    python3 -m rag.corpus             # 导入（已入库的 source_id 跳过）
    python3 -m rag.corpus --force     # 重建：先删旧的同来源文档再导入
    python3 -m rag.corpus --list      # 只列清单，不写库

不做什么：不抓期刊全文、不导入专家个人信息、不做任何打分或结论。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from . import config, db
from .retrieval import retriever
from .text import chunk_document, normalize_text

BASE_DIR = Path(__file__).resolve().parent.parent
CORPUS_DIR = BASE_DIR / "corpus"
MANIFEST = CORPUS_DIR / "sources.json"

ARTICLE_RE = re.compile(r"第[一二三四五六七八九十百零〇\d]+条")
ARTICLE_LINE_RE = re.compile(r"(?m)^\s*(第[一二三四五六七八九十百零〇\d]+条)")


class CorpusError(RuntimeError):
    """清单缺失、字段不全或文本不存在。"""


def load_manifest(path: Path | None = None) -> dict:
    manifest = Path(path or MANIFEST)
    if not manifest.exists():
        raise CorpusError(
            f"缺少溯源清单 {manifest}；先运行 python3 tools/fetch_corpus.py 生成快照"
        )
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CorpusError(f"溯源清单不是合法 JSON：{exc}") from exc
    if not data.get("sources"):
        raise CorpusError("溯源清单为空，没有可导入的语料")
    return data


def policy_entries(manifest: dict | None = None, root: Path | None = None) -> list[dict]:
    """清单里的政策条目，附带已解析的快照路径与文本。

    `root` 显式指定受信快照目录；默认只允许项目 corpus/ 内的相对路径。
    越界路径、缺失或不符的 sha256 一律拒绝——
    清单随仓库分发、启动时自动导入，不能成为任意本地文件的读取入口。
    """
    manifest = manifest or load_manifest()
    base = Path(root).resolve() if root else BASE_DIR.resolve()
    allowed = base if root is not None else CORPUS_DIR.resolve()
    out: list[dict] = []
    for entry in manifest.get("sources", []):
        if entry.get("kind") != "policy":
            continue
        raw = str(entry.get("text_path") or "").strip()
        if not raw:
            raise CorpusError(f"清单条目缺少 text_path：{entry.get('id')}")
        text_path = (base / raw).resolve()
        if (root is None and Path(raw).is_absolute()) or not text_path.is_relative_to(allowed) or not text_path.is_file():
            raise CorpusError(f"语料路径越界或不存在：{raw}")
        expected = str(entry.get("text_sha256") or "").strip().lower()
        if not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise CorpusError(f"语料缺少有效 sha256：{raw}")
        payload = text_path.read_bytes()
        if hashlib.sha256(payload).hexdigest() != expected:
            raise CorpusError(f"语料 sha256 与清单不一致：{raw}（快照可能被改动或截断）")
        out.append({**entry, "_path": text_path, "_text": payload.decode("utf-8")})
    return out


def _display_name(entry: dict) -> str:
    title = str(entry.get("title") or "").strip()
    doc_no = str(entry.get("doc_no") or "").strip()
    return f"{title}（{doc_no}）" if title and doc_no else title


def _label_articles(chunks: list[dict], source: str) -> None:
    """把「块首所属条」的条号补进 section，便于预审/问答按「章 · 条」引用。

    不能用「块内第一个条号」：分块落在某条正文中间时，块首其实是上一条的后半段，
    标签会指向块内下一个条号，与证据原文对不上。改为在全文里定位块首偏移，
    取它之前最近的那个条号。
    """
    # 分块会合并段落换行、归一数字；全文和块首使用相同的定位口径。
    source = normalize_text(source)
    def compact(value: str) -> str:
        return re.sub(r"\s+", "", value)

    marks = [(len(compact(source[:m.start()])), m.group(1))
             for m in ARTICLE_LINE_RE.finditer(source)]
    source = compact(source)
    cursor = 0
    for chunk in chunks:
        text = chunk.get("text") or ""
        section = (chunk.get("section") or "").strip()
        body = text[len(section):].lstrip("\n") if section and text.startswith(section) else text
        article = ""
        probe = compact(normalize_text(body))[:60]
        pos = source.find(probe, cursor) if probe else -1
        if pos < 0 and probe:
            pos = source.find(probe)
        if pos >= 0 and marks:
            cursor = pos
            for start, name in marks:
                if start <= pos:
                    article = name
                else:
                    break
        if not article or article in section:
            continue
        chunk["section"] = f"{section} · {article}".strip(" ·")


def _doc_meta(entry: dict) -> dict:
    return {
        "source_id": entry.get("id"),
        "url": entry.get("url"),
        "issuer": entry.get("issuer", ""),
        "doc_no": entry.get("doc_no", ""),
        "published_at": entry.get("published_at", ""),
        "license": entry.get("license", ""),
        "license_note": entry.get("license_note", ""),
        "fetched_at": entry.get("fetched_at", ""),
        "text_sha256": entry.get("text_sha256", ""),
        "manifest": "corpus/sources.json",
    }


def load_policies(
    force: bool = False, manifest: dict | None = None, root: Path | None = None
) -> dict:
    """把清单里的政策写入文档库；返回 {loaded, skipped, chunks, documents, relabeled}。"""
    entries = policy_entries(manifest, root=root)
    db.init_db()  # 幂等：新库/空目录时表还不存在（run.sh 在 uvicorn lifespan 之前调用）
    existing = db.public_policy_docs()
    loaded: list[dict] = []
    skipped: list[dict] = []
    chunk_total = 0
    relabeled = 0

    for entry in entries:
        source_id = str(entry.get("id") or "").strip()
        if not source_id:
            raise CorpusError(f"清单条目缺少 id：{entry.get('title')}")
        if source_id in existing:
            if not force:
                doc_id = existing[source_id]
                doc = db.get_document(doc_id)
                # 快照一致才修正章节元数据；不删文档、不改正文或引用 ID。
                if (doc and doc["kind"] == "policy" and
                        doc.get("meta", {}).get("text_sha256") == entry["text_sha256"]):
                    stored = db.get_chunks(doc_id)
                    corrected = []
                    for chunk in stored:
                        item = dict(chunk)
                        item["section"] = re.sub(r" · 第[一二三四五六七八九十百零〇\d]+条$", "", item["section"] or "")
                        corrected.append(item)
                    _label_articles(corrected, entry["_text"])
                    changes = [(new["section"], old["id"], doc_id)
                               for old, new in zip(stored, corrected)
                               if new["section"] != old["section"] and ARTICLE_RE.search(new["section"])]
                    if changes:
                        with db.connect() as conn:
                            conn.executemany("UPDATE chunks SET section = ? WHERE id = ? AND doc_id = ?", changes)
                        relabeled += len(changes)
                skipped.append({"id": source_id, "reason": "已入库"})
                continue
            db.delete_document(existing[source_id])

        text = entry["_text"]
        chunks = chunk_document(
            [{"page": None, "text": text}], config.CHUNK_SIZE, config.CHUNK_OVERLAP
        )
        _label_articles(chunks, text)
        doc = {
            "id": db.new_id(),
            "name": _display_name(entry),
            "kind": "policy",
            "year": entry.get("year"),
            "source": "public",
            "path": str(entry["_path"]),
            "text_len": len(text),
            "page_count": 0,
            "status": "ready" if chunks else "needs_review",
            "warning": "" if chunks else "未生成可用文本块，请检查语料快照。",
            "meta": _doc_meta(entry),
        }
        db.insert_document(doc, chunks)
        chunk_total += len(chunks)
        loaded.append({"id": source_id, "name": doc["name"], "chunks": len(chunks)})

    if loaded or relabeled:
        retriever.rebuild()

    return {
        "loaded": loaded,
        "skipped": skipped,
        "chunks": chunk_total,
        "documents": len(entries),
        "relabeled": relabeled,
    }


def describe(manifest: dict | None = None) -> list[str]:
    """清单的可读摘要，用于命令行输出与人工核对。"""
    manifest = manifest or load_manifest()
    existing = db.public_policy_docs()
    lines = [f"溯源清单：corpus/sources.json（{len(manifest.get('sources', []))} 条）"]
    for entry in manifest.get("sources", []):
        state = "已入库" if entry.get("id") in existing else "未入库"
        lines.append(
            f"  [{state}] {entry.get('id')}  {entry.get('title')}"
            f"（{entry.get('doc_no','')}）  {entry.get('text_chars', '?')} 字  "
            f"{entry.get('fetched_at','')[:10]}"
        )
        lines.append(f"        来源：{entry.get('url')}")
        lines.append(f"        许可：{entry.get('license')}")
    return lines


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="把 corpus/ 下的公开政策语料导入文档库")
    ap.add_argument("--force", action="store_true", help="删除同来源旧文档后重新导入")
    ap.add_argument("--list", action="store_true", help="只列清单，不写库")
    args = ap.parse_args(argv)

    try:
        # 新机器 / 空目录：uvicorn 的 lifespan 还没跑过，库表可能不存在（run.sh 在它之前调本命令）
        db.init_db()
        if args.list:
            for line in describe():
                print(line)
            return 0
        result = load_policies(force=args.force)
    except CorpusError as exc:
        print(f"[失败] {exc}")
        return 1

    for item in result["loaded"]:
        print(f"[导入] {item['name']}  {item['chunks']} 块")
    for item in result["skipped"]:
        print(f"[跳过] {item['id']}（{item['reason']}）")
    print(
        f"[完成] 清单 {result['documents']} 条：导入 {len(result['loaded'])}，"
        f"跳过 {len(result['skipped'])}，新增 {result['chunks']} 块"
    )
    if result["relabeled"]:
        print(f"[修正] {result['relabeled']} 块政策条号（保留文档与分块 ID）")
    if not result["loaded"]:
        print("提示：加 --force 可重建已入库的政策语料。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
