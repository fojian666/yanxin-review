from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from . import db
from .llm import LLMError, llm
from .text import STOPWORDS, extract_keywords, extract_terms, truncate

GENERIC_QUERIES = {"趋势", "研究趋势", "分析", "文献", "综述", "发展", "研究", "全部", "总体"}
GENERIC_KEYWORDS = {
    "研究", "分析", "应用", "方法", "技术", "系统", "问题", "影响", "进展",
    "综述", "实践", "探索", "构建", "机制", "路径", "对策", "设计", "实现",
}


def _paper_text(p: dict) -> str:
    return f"{p.get('title','')} {p.get('abstract','')} {p.get('keywords','')}"


def _keywords_of(p: dict) -> list[str]:
    kws = p.get("keywords_list") or []
    if not kws:
        kws = extract_keywords(_paper_text(p), topk=6)
    out: list[str] = []
    for kw in kws:
        kw = re.sub(r"\s+", "", str(kw)).strip(";；,，、")
        if len(kw) < 2 or kw in STOPWORDS or kw in GENERIC_KEYWORDS:
            continue
        if kw not in out:
            out.append(kw)
    return out[:8]


def _filter_relevant(papers: list[dict], query: str) -> tuple[list[dict], bool]:
    if not papers:
        return [], True
    query = (query or "").strip()
    if not query or query in GENERIC_QUERIES:
        return papers, False
    terms = extract_terms(query, max_terms=8)
    meaningful = [t for t in terms if t not in GENERIC_KEYWORDS and t not in STOPWORDS]
    if not meaningful:
        return papers, False
    texts = [_paper_text(p) for p in papers]
    vectorizer = TfidfVectorizer(analyzer="char", ngram_range=(2, 3), min_df=1, sublinear_tf=True)
    matrix = vectorizer.fit_transform(texts)
    q_vec = vectorizer.transform([query])
    scores = cosine_similarity(q_vec, matrix).ravel()
    hits_by_idx: list[int] = []
    for i, p in enumerate(papers):
        blob = f"{p.get('title','')} {p.get('keywords','')} {p.get('abstract','')}".lower()
        hits = sum(1 for t in meaningful if t.lower() in blob)
        hits_by_idx.append(hits)
        scores[i] += 0.08 * hits
    max_score = float(scores.max()) if len(scores) else 0.0
    if max_score < 0.02:
        return [], True
    ranked = sorted(zip(papers, scores, hits_by_idx), key=lambda x: -x[1])
    selected: list[tuple[dict, float]] = []
    for p, score, hits in ranked:
        # A paper must either contain the query term (title/keywords/abstract)
        # or clear a much higher pure-semantic threshold.
        if (hits > 0 and score >= 0.02) or score >= max(0.12, max_score * 0.6):
            selected.append((p, float(score)))
    if not selected:
        if max_score >= 0.12:
            selected = [(p, float(s)) for p, s, _ in ranked[:3]]
        else:
            return [], True
    out = []
    for p, score in selected:
        item = dict(p)
        item["relevance"] = round(score, 4)
        out.append(item)
    return out, False


def _trend_word(values: list[int]) -> str:
    if not values:
        return "稳定"
    first = values[0]
    last = values[-1]
    if last > max(1, first) * 1.25:
        return "上升"
    if last < first * 0.75:
        return "下降"
    return "波动"


def _rising_keyword(series: list[dict]) -> tuple[str, int]:
    best_name = ""
    best_delta = -10**9
    for item in series:
        values = item.get("values") or []
        if len(values) < 2:
            continue
        delta = values[-1] - values[0]
        if delta > best_delta:
            best_delta = delta
            best_name = item["name"]
    return best_name, best_delta


def _fallback_summary(query: str, years: list[int], counts: list[int], series: list[dict], papers: list[dict], sample: bool, total: int) -> str:
    if not papers:
        return (
            f"没有检索到与“{query or '全部主题'}”相关的文献。\n\n"
            "建议：在“文档库—文献数据”中导入包含标题、年份、摘要、关键词的 CSV，或换用更宽泛的主题词。"
        )
    # papers 只是按相关度截断的代表文献，篇数必须用全集计数，否则 15 篇会写成「共 12 篇」
    first = counts[0] if counts else 0
    last = counts[-1] if counts else 0
    trend = _trend_word(counts)
    top = [s["name"] for s in series[:3]]
    rising, delta = _rising_keyword(series)
    peak_idx = int(np.argmax(counts)) if counts else 0
    peak_year = years[peak_idx] if years else ""
    peak_count = counts[peak_idx] if counts else 0
    early = [s["name"] for s in series if len(s.get("values", [])) == len(years) and sum(1 for v in s["values"][:-2] if v > 0) == 0 and sum(s["values"][-2:]) > 0]
    emerging = early[0] if early else (rising if delta > 0 else "")
    lines = [
        f"{years[0] if years else ''}—{years[-1] if years else ''} 年共检索到 {total} 篇相关文献，"
        f"年度发文量由 {first} 篇变为 {last} 篇，整体呈{trend}趋势，{peak_year} 年最集中（{peak_count} 篇）。",
        f"高频主题为{'、'.join(top) if top else '相关内容'}。"
        + (f"其中“{rising}”的年度出现次数增长最明显（{delta:+d} 次），" if rising and delta != 0 else "")
        + "反映出相关研究关注度正在变化。",
    ]
    if emerging:
        lines.append(f"从时间分布看，“{emerging}”属于较晚出现、近年升温的方向，可作为后续跟踪重点。")
    lines.append("建议结合真实文献数据，对上述主题词做人工校核，并进一步区分基础研究、管理实践与政策研究。")
    if sample:
        lines.append("说明：当前使用演示数据（合成文献），结论仅用于验证趋势分析功能。")
    return "\n".join(lines)


def _llm_summary(query: str, years: list[int], counts: list[int], series: list[dict], papers: list[dict], sample: bool, total: int) -> tuple[str, str]:
    if not llm.configured or not papers:
        return "", ""
    stats = (
        f"查询主题：{query or '全部文献'}\n"
        f"年份范围：{years[0] if years else ''}-{years[-1] if years else ''}\n"
        f"相关文献总篇数：{total}（下列为代表文献，不是全集）\n"
        f"年度发文量：{dict(zip(years, counts))}\n"
        f"主题年度分布："
        + "；".join(f"{s['name']}:{s['values']}" for s in series[:6])
    )
    reps = "\n".join(
        f"- {p.get('year','')}《{p.get('title','')}》 关键词：{p.get('keywords','')} 摘要：{truncate(p.get('abstract',''), 120)}"
        for p in papers[:10]
    )
    system = """你是科研文献趋势分析专家。只依据给定的统计数据和文献信息分析趋势，不得编造文献、数据或结论。
输出 3-5 条中文要点，每条不超过 80 字，指出：总体趋势、上升/下降主题、阶段变化、研究空白或建议。不要给立项结论。"""
    user = f"主题：{query or '全部文献'}\n\n统计数据：\n{stats}\n\n代表性文献：\n{reps}\n\n请给出趋势研判。"
    try:
        text = llm.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.2,
            max_tokens=900,
        )
        if text:
            if sample:
                text += "\n\n说明：当前使用演示数据（合成文献），结论仅用于验证趋势分析功能。"
            return text, ""
    except LLMError as exc:
        return "", f"大模型调用失败，已使用规则趋势摘要：{exc}"
    return "", ""


def analyze_trends(query: str = "科研诚信", start_year: int | None = None, end_year: int | None = None) -> dict[str, Any]:
    all_papers = db.list_papers()
    if start_year is None:
        start_year = min([p["year"] for p in all_papers if p.get("year")], default=2019)
    if end_year is None:
        end_year = max([p["year"] for p in all_papers if p.get("year")], default=2025)
    start_year = max(2000, min(int(start_year), 2035))
    end_year = max(start_year, min(int(end_year), 2035))
    pool = [p for p in all_papers if p.get("year") and start_year <= int(p["year"]) <= end_year]
    relevant, no_match = _filter_relevant(pool, query)
    years = list(range(start_year, end_year + 1))
    counts = [sum(1 for p in relevant if int(p.get("year") or 0) == y) for y in years]

    query_terms = [
        t for t in extract_terms(query, max_terms=6)
        if t not in GENERIC_KEYWORDS and t not in STOPWORDS
    ]
    keyword_year: dict[str, Counter] = defaultdict(Counter)
    keyword_total: Counter = Counter()
    per_year_top: dict[int, Counter] = defaultdict(Counter)
    for p in relevant:
        y = int(p.get("year") or 0)
        kws = _keywords_of(p)
        text = _paper_text(p)
        # Query terms can appear in title/abstract without being author keywords.
        for term in query_terms:
            if term not in kws and term in text:
                kws.append(term)
        for kw in kws:
            keyword_year[kw][y] += 1
            keyword_total[kw] += 1
            per_year_top[y][kw] += 1

    ranked_kw = keyword_total.most_common()
    top_names: list[str] = [t for t in query_terms if t in keyword_total]
    for name, count in ranked_kw:
        if len(top_names) >= 6:
            break
        if count >= 2 and name not in top_names:
            top_names.append(name)
    for name, _ in ranked_kw:
        if len(top_names) >= 3:
            break
        if name not in top_names:
            top_names.append(name)
    series = [
        {"name": name, "values": [int(keyword_year[name].get(y, 0)) for y in years]}
        for name in top_names[:6]
    ]

    top_by_year = []
    for y in years:
        items = [{"name": k, "count": v} for k, v in per_year_top[y].most_common(4)]
        top_by_year.append({"year": y, "keywords": items})

    ranked = sorted(relevant, key=lambda p: (-float(p.get("relevance", 0)), -int(p.get("year") or 0)))
    papers_out = []
    for p in ranked[:12]:
        papers_out.append(
            {
                "id": p.get("id"),
                "title": p.get("title", ""),
                "year": p.get("year"),
                "authors": p.get("authors", ""),
                "venue": p.get("venue", ""),
                "keywords": p.get("keywords", ""),
                "abstract": p.get("abstract", ""),
                "relevance": p.get("relevance", 0),
                "is_sample": bool(p.get("is_sample")),
            }
        )

    sample = any(p.get("is_sample") for p in relevant)
    top_keyword = top_names[0] if top_names else ""
    first = counts[0] if counts else 0
    last = counts[-1] if counts else 0
    growth = None if first == 0 else round((last - first) / first * 100, 1)
    stats = {
        "total": len(relevant),
        "year_start": start_year,
        "year_end": end_year,
        "top_keyword": top_keyword,
        "growth_pct": growth,
        "first_year_count": first,
        "last_year_count": last,
        "sample_count": sum(1 for p in relevant if p.get("is_sample")),
        "real_count": sum(1 for p in relevant if not p.get("is_sample")),
    }

    summary, warning = _llm_summary(query, years, counts, series, papers_out, sample, stats["total"])
    mode = "qwen" if summary else "offline"
    if not summary:
        summary = _fallback_summary(query, years, counts, series, papers_out, sample, stats["total"])
    if mode == "offline" and not no_match:
        summary = summary.rstrip() + "\n- 口径：以上为规则统计与关键词摘要（离线模式），未做语义研判与文献质量评估。"
    if no_match:
        summary = (
            f"没有检索到与“{query}”相关的文献。当前文献库共 {len(all_papers)} 篇，"
            "请换用更宽泛的主题词，或在“文档库—文献数据”中导入真实文献 CSV。"
        )
        mode = "offline"

    return {
        "query": query,
        "years": years,
        "counts": counts,
        "keyword_series": series,
        "top_keywords_by_year": top_by_year,
        "papers": papers_out,
        "summary": summary,
        "mode": mode,
        "warning": warning,
        "sample": sample,
        "no_match": no_match,
        "stats": stats,
    }
