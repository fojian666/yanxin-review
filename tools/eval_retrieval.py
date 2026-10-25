"""检索召回对比：同一批问题，TF-IDF 与向量各跑一遍，看命中率差多少。

用法：

    python3 -m tools.eval_retrieval            # 默认 k=3
    python3 -m tools.eval_retrieval --k 5

判定口径：每个问题有一组「真正能回答它的分块」（按原文关键句定位，不靠人工挑），
只要 top-k 里出现任一条就算命中；同时给出 MRR（第一个命中排在第几位）。
两种模式走的是同一条生产链路（含关键词/章节加权），差异只来自打分层。
"""
from __future__ import annotations

import argparse
import sys

from rag import db
from rag.retrieval import retriever

# (问题, 原文定位句) —— 定位句在语料里唯一指向「正确答案分块」
CASES: list[tuple[str, list[str]]] = [
    ("被处理人对处理决定不服，多长时间内可以提出申诉", ["15个工作日"]),
    ("调查人员要不要签署保密协议", ["保密协议"]),
    ("科研失信行为有哪些可以从轻处理的情形", ["可从轻处理"]),
    ("举报科研失信行为可以通过哪些途径", ["可通过下列途径"]),
    ("什么是买卖实验研究数据", ["买卖实验研究数据，是指"]),
    ("信用修复申请怎么提出", ["信用修复申请"]),
    ("江苏省科技计划项目信用管理涵盖哪些环节", ["信用管理内容涵盖"]),
    ("联合惩戒是怎么实施的", ["联合惩戒"]),
    ("调查取证时禁止使用哪些手段", ["严禁以威胁、引诱、欺骗"]),
    ("信用良好的责任主体能获得什么激励", ["信用评价为良好信用"]),
    ("自然科学领域的调查处理工作由谁统筹", ["统筹自然科学"]),
    ("论文代写代投怎么认定", ["代写"]),
    ("项目承担单位在调查中要做什么", ["项目承担单位"]),
    ("失信行为被记录后会被采取哪些处理措施", ["信用评价为一般失信和严重失信"]),
]


def gold_indices(rows: list[dict]) -> list[list[int]]:
    golds = []
    for _, needles in CASES:
        hits = [
            i
            for i, row in enumerate(rows)
            if any(n in (row.get("text") or "") for n in needles)
        ]
        golds.append(hits)
    return golds


def run(k: int) -> int:
    retriever.rebuild()
    if not retriever.ready:
        print("索引为空：先上传文档或导入政策语料")
        return 1

    policy_ids = {d["id"] for d in db.list_documents() if d.get("kind") == "policy"}
    rows = [c for c in retriever.chunks if c["doc_id"] in policy_ids]
    rows.sort(key=lambda r: (r["doc_id"], r.get("idx") or 0))
    golds = gold_indices(rows)
    if any(not g for g in golds):
        missing = [CASES[i][0] for i, g in enumerate(golds) if not g]
        print("以下问题的定位句在语料里找不到，请先核对语料版本：", file=sys.stderr)
        for q in missing:
            print("  -", q, file=sys.stderr)
        return 2

    gold_keys = [{rows[i]["id"] for i in g} for g in golds]

    embedding_available = retriever.uses_embedding
    modes = ["TF-IDF"] + (["向量"] if embedding_available else [])
    saved = retriever.embed_matrix

    ranks: dict[str, list[int | None]] = {}
    try:
        for mode in modes:
            retriever.embed_matrix = None if mode == "TF-IDF" else saved
            found: list[int | None] = []
            for (question, _), gold in zip(CASES, gold_keys):
                hits = retriever.search(question, scope=list(policy_ids), top_k=max(k, 3))
                rank = next(
                    (pos for pos, hit in enumerate(hits, start=1) if hit["chunk_id"] in gold),
                    None,
                )
                found.append(rank)
            ranks[mode] = found
    finally:
        retriever.embed_matrix = saved  # 中途异常也不能把全局检索留在降级状态

    width = max(len(q) for q, _ in CASES) + 2
    header = f"{'问题':<{width}}" + "".join(f"{m + ' 名次':>12}" for m in modes)
    print(header)
    print("-" * (width + 12 * len(modes)))
    for i, (question, _) in enumerate(CASES):
        cells = [
            "未命中" if ranks[m][i] is None else f"第 {ranks[m][i]} 位" for m in modes
        ]
        print(f"{question:<{width}}" + "".join(f"{c:>12}" for c in cells))

    print("-" * (width + 12 * len(modes)))
    for mode in modes:
        values = ranks[mode]
        hit_k = sum(1 for r in values if r is not None and r <= k) / len(values)
        hit_1 = sum(1 for r in values if r == 1) / len(values)
        mrr = sum(0.0 if r is None else 1.0 / r for r in values) / len(values)
        print(f"{mode}: 命中@{k} {hit_k:.1%}  命中@1 {hit_1:.1%}  MRR {mrr:.3f}")
    if not embedding_available:
        print(
            "\n提示：向量索引未启用（EMBED_BACKEND=none 或密钥/门禁未通过），"
            "本次只跑了 TF-IDF。"
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="TF-IDF 与向量检索召回对比")
    parser.add_argument("--k", type=int, default=3, help="命中窗口，默认 3")
    return run(max(1, parser.parse_args().k))


if __name__ == "__main__":
    raise SystemExit(main())
