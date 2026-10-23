from __future__ import annotations

import threading
from typing import Iterable

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from . import db
from .text import extract_terms


class Retriever:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.chunks: list[dict] = []
        self.vectorizer: TfidfVectorizer | None = None
        self.matrix = None

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

    @property
    def ready(self) -> bool:
        return self.vectorizer is not None and self.matrix is not None and len(self.chunks) > 0

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
            q_vec = self.vectorizer.transform([query[:1500]])
            scores = cosine_similarity(q_vec, self.matrix).ravel()
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
            for idx in order:
                score = float(scores[idx])
                if score <= 0.0:
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
            best: dict[str, dict] = {}
            for row_i, local_idx in enumerate(idxs):
                target_chunk = self.chunks[local_idx]
                row = sims[row_i]
                for j in np.argsort(-row)[:80]:
                    other = self.chunks[int(j)]
                    if other["doc_id"] == doc_id:
                        continue
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
