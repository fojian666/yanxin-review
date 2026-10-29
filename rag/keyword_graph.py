"""从已收录文本构造可追溯的关键词共现图，不调用外部服务。"""
from __future__ import annotations

from collections import Counter, defaultdict
from functools import lru_cache
from itertools import combinations
import math
import re

import jieba.analyse

from . import db
from .text import STOPWORDS, normalize_text


@lru_cache(maxsize=4096)
def _chunk_terms(text: str) -> tuple[str, ...]:
    terms = jieba.analyse.extract_tags(
        normalize_text(text), topK=32, allowPOS=("n", "nz", "nt", "vn", "eng")
    )
    return tuple(dict.fromkeys(
        term for term in terms
        if 2 <= len(term) <= 12 and term not in STOPWORDS
        and re.search(r"[\u4e00-\u9fffA-Za-z]", term)
        and re.fullmatch(r"[\u4e00-\u9fffA-Za-z0-9]+", term)
    ))


def build_keyword_graph(limit: int = 100) -> dict:
    """按分块出现次数选词，再按词的分块共现余弦计算关联。"""
    docs = {doc["id"]: doc for doc in db.list_documents()}
    contexts = []
    counts: Counter[str] = Counter()
    sources: dict[str, list[dict]] = defaultdict(list)
    indexed_documents: set[str] = set()
    for chunk in db.get_chunks():
        doc = docs.get(chunk["doc_id"])
        if not doc:
            continue
        text = chunk.get("text") or ""
        terms = _chunk_terms(text)
        if not terms:
            continue
        contexts.append(terms)
        indexed_documents.add(doc["id"])
        counts.update(terms)
        for term in terms:
            if len(sources[term]) < 4:
                offset = text.find(term)
                start = max(0, offset - 55) if offset >= 0 else 0
                sources[term].append({
                    "doc_id": doc["id"], "doc_name": doc["name"],
                    "chunk_idx": chunk["idx"], "section": chunk.get("section") or "",
                    "page": chunk.get("page"), "excerpt": text[start:start + 150],
                })
    chosen = sorted(counts, key=lambda term: (-counts[term], term))[:max(0, min(limit, 100))]
    selected = set(chosen)
    pairs: Counter[tuple[str, str]] = Counter()
    for terms in contexts:
        present = sorted(set(terms) & selected)
        pairs.update(combinations(present, 2))
    candidates: dict[str, list[tuple[float, str, int]]] = defaultdict(list)
    for (a, b), common in pairs.items():
        score = common / math.sqrt(counts[a] * counts[b])
        if score >= 0.18:
            candidates[a].append((score, b, common))
            candidates[b].append((score, a, common))
    selected_pairs = set()
    for term in chosen:
        for score, other, common in sorted(candidates[term], key=lambda item: (-item[0], -item[2], item[1]))[:3]:
            selected_pairs.add(tuple(sorted((term, other))))
    links = []
    for a, b in sorted(selected_pairs):
        common = pairs[(a, b)]
        links.append({"source": a, "target": b, "similarity": round(common / math.sqrt(counts[a] * counts[b]), 3), "shared_chunks": common})
    return {
        "nodes": [{"id": term, "name": term, "chunk_count": counts[term], "sources": sources[term]} for term in chosen],
        "links": links,
        "method": "分块关键词共现余弦",
        "document_count": len(indexed_documents),
        "limit": 100,
    }
