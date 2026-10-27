from __future__ import annotations

import logging
import threading
from typing import Iterable

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from . import config, db
from .embeddings import EmbeddingUnavailable, embedder
from .text import extract_terms

log = logging.getLogger("rag.retrieval")


class Retriever:
    """分块检索。

    两套打分并存，对外接口不变：

    - TF-IDF（字符 n-gram）：始终构建，是基线，也是嵌入不可用时的回落；
    - 向量（embedding）：可用时接管 `search()`，捕获同义改写（「学术不端」↔「科研失信」）。

    `similarity_between_docs()` 固定走 TF-IDF：查重要看的是字面重合，
    向量会把「主题相近但没有重复」判成高相似，反而制造误报。
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.chunks: list[dict] = []
        self.vectorizer: TfidfVectorizer | None = None
        self.matrix = None
        self.embed_matrix: np.ndarray | None = None
        self.embed_model: str = ""

    def rebuild(self) -> None:
        with self._lock:
            docs = {d["id"]: d for d in db.list_documents()}
            chunks = []
            for row in db.get_chunks():
                doc = docs.get(row["doc_id"])
                if not doc:
                    # 文档已删除但分块残留（孤儿块），不进入索引
                    continue
                item = dict(row)
                item["doc_name"] = doc["name"]
                item["doc_kind"] = doc["kind"]
                chunks.append(item)
            self.chunks = chunks
            self.vectorizer = None
            self.matrix = None
            self.embed_matrix = None
            self.embed_model = ""
            if not chunks:
                return
            corpus = [
                f"{c.get('doc_name','')} {c.get('section','')} {c.get('text','')}"
                for c in chunks
            ]
            self.vectorizer = TfidfVectorizer(
                analyzer="char",
                ngram_range=(2, 4),
                min_df=1,
                max_features=90000,
                sublinear_tf=True,
                dtype=np.float32,
            )
            self.matrix = self.vectorizer.fit_transform(corpus)
            self._build_embedding(corpus)

    def _build_embedding(self, corpus: list[str]) -> None:
        """嵌入是增强项：任何失败都只记录并退回 TF-IDF，不影响可用性。"""
        try:
            matrix = embedder.embed(corpus)
        except EmbeddingUnavailable as exc:
            log.info("向量索引未建立，检索走 TF-IDF：%s", exc)
            return
        except Exception as exc:  # 网络/额度/依赖等异常一律降级
            log.warning("向量索引建立失败，检索走 TF-IDF：%s", exc)
            return
        if matrix.shape[0] != len(self.chunks):
            log.warning(
                "向量行数 %s 与分块数 %s 不符，丢弃向量索引",
                matrix.shape[0],
                len(self.chunks),
            )
            return
        self.embed_matrix = matrix
        self.embed_model = embedder.status().get("model") or ""

    @property
    def ready(self) -> bool:
        return self.vectorizer is not None and self.matrix is not None and len(self.chunks) > 0

    @property
    def uses_embedding(self) -> bool:
        return self.embed_matrix is not None

    @property
    def score_floor(self) -> float:
        """低于此分不进结果。

        TF-IDF 的无关文本余弦接近 0，0 就是天然下限；向量对无关中文段落有 0.3~0.4 的底噪，
        不设下限会导致「问什么都不缺资料」，把无关条款喂给模型和评审人。
        """
        return config.EMBED_MIN_SCORE if self.uses_embedding else 0.0

    def _score_embedding(self, query: str) -> np.ndarray | None:
        """向量余弦；失败则熔断（本次索引不再尝试），交给 TF-IDF。"""
        try:
            vector = embedder.embed([query[:1500]], cache=False)[0]
        except Exception as exc:
            log.warning("查询向量化失败，本索引改用 TF-IDF：%s", exc)
            self.embed_matrix = None
            self.embed_model = ""
            return None
        return self.embed_matrix @ vector.astype(np.float32)

    def _score_tfidf(self, query: str) -> np.ndarray:
        q_vec = self.vectorizer.transform([query[:1500]])
        return cosine_similarity(q_vec, self.matrix).ravel()

    def _keyword_hits(self, query_terms: Iterable[str], text: str) -> int:
        text_l = (text or "").lower()
        return sum(text_l.count(t.lower()) for t in query_terms if t)

    def search(
        self,
        query: str,
        scope: list[str] | None = None,
        top_k: int = 7,
    ) -> list[dict]:
        query = (query or "").strip()
        if not query:
            return []
        with self._lock:
            if not self.ready:
                return []
            scores = self._score_embedding(query) if self.uses_embedding else None
            if scores is None:
                scores = self._score_tfidf(query)
            terms = extract_terms(query, max_terms=8)
            for i, chunk in enumerate(self.chunks):
                hits = self._keyword_hits(terms, chunk.get("text", ""))
                if hits:
                    scores[i] += min(0.09, 0.012 * hits)
                section = chunk.get("section") or ""
                if section and any(t and t in section for t in terms):
                    scores[i] += 0.06
            if scope:
                scope_set = set(scope)
                mask = np.array([c["doc_id"] in scope_set for c in self.chunks])
                scores = np.where(mask, scores, -1.0)
            order = np.argsort(-scores)
            results: list[dict] = []
            per_doc: dict[str, int] = {}
            floor = self.score_floor
            for idx in order:
                score = float(scores[idx])
                if score <= floor:
                    break
                chunk = self.chunks[int(idx)]
                doc_id = chunk["doc_id"]
                if per_doc.get(doc_id, 0) >= 5:
                    continue
                per_doc[doc_id] = per_doc.get(doc_id, 0) + 1
                results.append(
                    {
                        "chunk_id": chunk["id"],
                        "idx": chunk.get("idx", 0),
                        "doc_id": doc_id,
                        "doc_name": chunk.get("doc_name", ""),
                        "doc_kind": chunk.get("doc_kind", ""),
                        "page": chunk.get("page"),
                        "section": chunk.get("section") or "",
                        "text": chunk.get("text", ""),
                        "score": round(score, 4),
                    }
                )
                if len(results) >= top_k:
                    break
            return results

    def similarity_between_docs(self, doc_id: str, top_k: int = 5) -> list[dict]:
        with self._lock:
            if not self.ready:
                return []
            idxs = [i for i, c in enumerate(self.chunks) if c["doc_id"] == doc_id]
            if not idxs:
                return []
            target_matrix = self.matrix[idxs]
            sims = cosine_similarity(target_matrix, self.matrix)
            excluded = [i for i, c in enumerate(self.chunks)
                        if c["doc_id"] == doc_id or c.get("doc_kind") == "policy"]
            best: dict[str, dict] = {}
            for row_i, local_idx in enumerate(idxs):
                target_chunk = self.chunks[local_idx]
                # 同文档与政策先遮蔽，避免挤占 top-N；政策仍参与问答检索。
                row = sims[row_i].copy()
                row[excluded] = -1.0
                for j in np.argsort(-row)[:80]:
                    other = self.chunks[int(j)]
                    score = float(row[int(j)])
                    if score <= 0.05:
                        continue
                    current = best.get(other["doc_id"])
                    if current is None or score > current["similarity"]:
                        best[other["doc_id"]] = {
                            "matched_doc_id": other["doc_id"],
                            "matched_doc_name": other.get("doc_name", ""),
                            "similarity": round(score, 4),
                            "source_snippet": (target_chunk.get("text") or "")[:260],
                            "matched_snippet": (other.get("text") or "")[:260],
                        }
            items = sorted(best.values(), key=lambda x: -x["similarity"])
            return items[:top_k]

    def chunks_of(self, doc_id: str) -> list[dict]:
        with self._lock:
            return [dict(c) for c in self.chunks if c["doc_id"] == doc_id]


retriever = Retriever()
