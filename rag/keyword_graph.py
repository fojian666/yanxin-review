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

SOURCE_DOCUMENT_LIMIT = 8


@lru_cache(maxsize=50_000)
def _chunk_terms(text: str) -> tuple[str, ...]:
    # 共现图只需要稳定词条。词性标注会把每个分块送入 posseg/viterbi，
    # 全库首次构图实测从约 58 秒降到约 4 秒。
    terms = jieba.analyse.extract_tags(normalize_text(text), topK=32)
    return tuple(dict.fromkeys(
        term for term in terms
        if 2 <= len(term) <= 12 and term not in STOPWORDS
        and re.search(r"[\u4e00-\u9fffA-Za-z]", term)
        and re.fullmatch(r"[\u4e00-\u9fffA-Za-z0-9]+", term)
    ))


def prewarm_terms(chunks: list[dict]) -> None:
    """服务启动后预填与权限无关的分块词条缓存，避免首个图谱请求冷算。"""
    for chunk in chunks:
        _chunk_terms(chunk.get("text") or "")


def _cluster_terms(terms: list[str], links: list[dict]) -> dict[str, int | None]:
    """按加权模块度局部优化分组；孤立词不强行归类。"""
    neighbors: dict[str, dict[str, float]] = {term: {} for term in terms}
    for link in links:
        a, b, weight = link["source"], link["target"], link["similarity"]
        neighbors[a][b] = weight
        neighbors[b][a] = weight
    degrees = {term: sum(edges.values()) for term, edges in neighbors.items()}
    total = sum(degrees.values())
    if not total:
        return {term: None for term in terms}
    labels = {term: term for term in terms}
    strengths = dict(degrees)
    for _ in range(20):
        changed = False
        for term in terms:
            degree = degrees[term]
            if not degree:
                continue
            old = labels[term]
            strengths[old] -= degree
            weights: Counter[str] = Counter()
            for other, weight in neighbors[term].items():
                weights[labels[other]] += weight
            weights.setdefault(old, 0)
            best = max(sorted(weights), key=lambda group: weights[group] - degree * strengths[group] / total)
            strengths[best] += degree
            labels[term] = best
            changed |= best != old
        if not changed:
            break
    # 合并仍有正模块度增益的相邻小组，避免大图碎成几十个零散小团。
    while True:
        between: Counter[tuple[str, str]] = Counter()
        for link in links:
            a, b = labels[link["source"]], labels[link["target"]]
            if a != b:
                between[tuple(sorted((a, b)))] += link["similarity"]
        gains = [(weight - strengths[a] * strengths[b] / total, a, b) for (a, b), weight in between.items()]
        if not gains:
            break
        gain, target, source = max(gains, key=lambda item: (item[0], item[1], item[2]))
        if gain <= 1e-12:
            break
        for term in terms:
            if labels[term] == source:
                labels[term] = target
        strengths[target] += strengths[source]
        strengths[source] = 0
    groups: dict[str, list[str]] = defaultdict(list)
    for term in terms:
        if degrees[term]:
            groups[labels[term]].append(term)
    ordered = sorted((group for group in groups.values() if len(group) > 1), key=lambda group: (-len(group), terms.index(group[0])))
    result: dict[str, int | None] = {term: None for term in terms}
    for index, group in enumerate(ordered):
        for term in group:
            result[term] = index + 1
    return result


def build_keyword_graph(
    limit: int = 100,
    doc_ids: set[str] | None = None,
    chunks: list[dict] | None = None,
) -> dict:
    """按分块出现次数选词，再按词的分块共现余弦计算关联。"""
    docs = {doc["id"]: doc for doc in db.list_documents() if doc_ids is None or doc["id"] in doc_ids}
    contexts: list[tuple[str, dict, tuple[str, ...]]] = []
    counts: Counter[str] = Counter()
    sources: dict[str, list[dict]] = defaultdict(list)
    source_documents: dict[str, set[str]] = defaultdict(set)
    term_documents: dict[str, set[str]] = defaultdict(set)
    indexed_documents: set[str] = set()
    # 正常服务复用检索器已加载的分块；测试或索引尚未构建时回退数据库。
    chunk_rows = chunks or db.get_chunks()
    for chunk in chunk_rows:
        doc = docs.get(chunk["doc_id"])
        if not doc:
            continue
        text = chunk.get("text") or ""
        terms = _chunk_terms(text)
        if not terms:
            continue
        contexts.append((doc["id"], chunk, terms))
        indexed_documents.add(doc["id"])
        counts.update(terms)
    limit = max(1, min(limit, 500))
    chosen = sorted(counts, key=lambda term: (-counts[term], term))[:limit]
    selected = set(chosen)
    pairs: Counter[tuple[str, str]] = Counter()
    for doc_id, chunk, terms in contexts:
        present = sorted(set(terms) & selected)
        pairs.update(combinations(present, 2))
        for term in present:
            term_documents[term].add(doc_id)
            # 每个关键词优先返回不同文档的原文片段；同一文档只占一个位置，
            # 避免四个片段全部来自一份材料而让人误以为只同步了少量文档。
            if len(sources[term]) >= SOURCE_DOCUMENT_LIMIT or doc_id in source_documents[term]:
                continue
            source_documents[term].add(doc_id)
            text = chunk.get("text") or ""
            offset = text.find(term)
            start = max(0, offset - 55) if offset >= 0 else 0
            sources[term].append({
                "doc_id": doc_id, "doc_name": docs[doc_id]["name"],
                "chunk_idx": chunk["idx"], "section": chunk.get("section") or "",
                "page": chunk.get("page"), "excerpt": text[start:start + 150],
            })
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
    clusters = _cluster_terms(chosen, links)
    return {
        "nodes": [
            {
                "id": term,
                "name": term,
                "chunk_count": counts[term],
                "source_document_count": len(term_documents[term]),
                "sources": sources[term],
                "cluster": clusters[term],
            }
            for term in chosen
        ],
        "links": links,
        "method": "分块关键词共现余弦",
        "document_count": len(indexed_documents),
        "limit": limit,
    }
