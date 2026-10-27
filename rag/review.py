from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any

from . import db
from .llm import LLMError, llm
from .retrieval import retriever
from .text import extract_terms, truncate

log = logging.getLogger("rag.review")

REQUIRED_SECTIONS = [
    {"key": "background", "label": "立项背景与研究目标", "terms": ["立项背景", "研究背景", "研究目标", "研究意义"], "core": True},
    {"key": "content", "label": "研究内容", "terms": ["研究内容", "主要研究内容"], "core": True},
    {"key": "method", "label": "研究方法与技术路线", "terms": ["研究方法", "技术路线", "研究路线"], "core": True},
    {"key": "innovation", "label": "创新点与特色", "terms": ["创新点", "创新之处", "特色与创新", "创新性"], "core": False},
    {"key": "indicators", "label": "考核指标与预期成果", "terms": ["考核指标", "预期成果", "成果形式", "提交成果"], "core": True},
    {"key": "budget", "label": "经费预算", "terms": ["经费预算", "经费测算", "预算"], "core": False},
    {"key": "team", "label": "研究基础与团队分工", "terms": ["研究基础", "承担单位", "主要研究人员", "人员分工", "团队"], "core": False},
    {"key": "integrity", "label": "科研诚信与数据安全", "terms": ["科研诚信", "学术不端", "科研伦理", "科技伦理", "数据安全", "保密", "知识产权", "利益冲突"], "core": True},
]

INTEGRITY_TERMS = ["科研诚信", "学术不端", "科研伦理", "科技伦理", "数据安全", "保密", "知识产权", "利益冲突"]

# 没有模型时，报告里必须写清「这些结论只到哪一步」，否则读者会把规则检查当成语义判断
OFFLINE_LIMITATIONS = [
    "当前未启用大模型（或调用失败）：以下判断来自规则与检索，不含语义归纳、前后矛盾识别与表述质量评估。",
    "政策合规只提示可能相关的条款，不判断适用版本与时效，引用前须人工核对。",
    "查重只比对字面重合，改写、翻译、调换语序的重复识别不出来。",
]

DISCLAIMER = "本报告由 AI 基于上传文档自动生成，仅作为形式检查与评审辅助参考，不构成立项、资助、处罚结论，须经专家和管理人员复核。"

# 政策合规的口径说明：离线与模型两条路径都必须带上，否则同一份报告两种说法
POLICY_NOTE = " 政策合规项为提示性质，不计入风险等级，引用前须人工核对适用版本与条款。"

# 政策合规检索：本文主题词 + 领域兜底词；低于阈值的命中不入报告（宁缺勿滥）
POLICY_QUERY_TERMS = ["科研诚信", "项目管理", "评审", "合规", "经费", "数据安全", "知识产权"]
POLICY_GENERIC_TERMS = {
    "研究", "项目", "课题", "方法", "技术", "分析", "系统", "问题", "内容", "设计", "实现",
}
# 两种打分尺度不同，阈值必须分开：
# TF-IDF 的无关文本余弦接近 0；向量（bge-m3）对无关中文段落也有 0.3~0.4 的底噪。
# 0.58 来自本语料实测：泛泛提问时最高分约 0.62，而真正对口的条款在 0.68 以上。
POLICY_MIN_SCORE = 0.08       # TF-IDF 余弦
POLICY_MIN_SCORE_EMBED = 0.58  # 向量余弦


def _policy_min_score() -> float:
    return POLICY_MIN_SCORE_EMBED if retriever.uses_embedding else POLICY_MIN_SCORE


def _find_evidence(text: str, terms: list[str]) -> str:
    for term in terms:
        for line in text.splitlines():
            if term in line and len(line.strip()) > 2:
                return truncate(line.strip(), 160)
    return ""


def _map_status(value: str, default: str = "warn") -> str:
    s = (value or "").strip().lower()
    if s in {"pass", "ok", "通过", "符合", "低", "low", "无风险"}:
        return "pass"
    if s in {"warn", "warning", "关注", "存疑", "中", "medium", "一般"}:
        return "warn"
    if s in {"fail", "risk", "不通过", "不符合", "高", "high", "风险"}:
        return "fail"
    return default


def _overall_status(items: list[dict]) -> str:
    statuses = [i.get("status") for i in items]
    if "fail" in statuses:
        return "fail"
    if "warn" in statuses:
        return "warn"
    return "pass"


def _heuristic_sections(text: str, doc: dict, duplicate_matches: list[dict], policy_cites: list[dict], has_policy_docs: bool) -> tuple[list[dict], list[str]]:
    completeness_items = []
    questions: list[str] = []
    for sec in REQUIRED_SECTIONS:
        found = [t for t in sec["terms"] if t in text]
        status = "pass" if found else ("fail" if sec["core"] else "warn")
        completeness_items.append(
            {
                "label": sec["label"],
                "status": status,
                "detail": f"已识别：{'、'.join(found[:3])}" if found else "未在文档中识别到对应章节或表述",
                "evidence": _find_evidence(text, sec["terms"]),
            }
        )
        if not found:
            if sec["key"] == "innovation":
                questions.append("请补充与已有研究/同类项目相比的差异化创新点，并说明可验证的创新依据。")
            elif sec["key"] == "indicators":
                questions.append("请补充可量化、可验收的考核指标，并说明与研究内容的一一对应关系。")
            elif sec["key"] == "budget":
                questions.append("请补充经费测算依据，说明与研究任务、考核指标的匹配关系。")
            elif sec["key"] == "integrity":
                questions.append("请补充科研诚信、数据安全、伦理审查与知识产权归属的承诺和具体措施。")
            elif sec["key"] == "background":
                questions.append("请补充立项背景、问题指向与研究目标的对应关系。")
            elif sec["key"] == "content":
                questions.append("请补充研究内容，并说明各研究任务与考核指标的对应关系。")
            elif sec["key"] == "method":
                questions.append("请补充技术路线的关键节点、数据来源、方法选择和风险预案。")

    integrity_items = []
    found_integrity = [t for t in INTEGRITY_TERMS if t in text]
    integrity_items.append(
        {
            "label": "科研诚信与数据安全表述",
            "status": "pass" if found_integrity else "warn",
            "detail": f"已识别：{'、'.join(found_integrity[:4])}" if found_integrity else "未识别到科研诚信/数据安全/伦理/知识产权相关表述",
            "evidence": _find_evidence(text, INTEGRITY_TERMS),
        }
    )
    has_refs = ("参考文献" in text) or bool(re.search(r"\[\d{1,3}\]", text))
    integrity_items.append(
        {
            "label": "参考文献与引用规范",
            "status": "pass" if has_refs else "warn",
            "detail": "已识别参考文献或编号引用" if has_refs else "未识别到参考文献或编号引用，建议补充以支撑立项依据",
            "evidence": "参考文献" if "参考文献" in text else "",
        }
    )
    integrity_items.append(
        {
            "label": "文档完整性",
            "status": "pass" if len(text) >= 1500 else "fail",
            "detail": f"共 {len(text)} 字、{len(text.splitlines())} 个文本段落" + ("，内容偏短，可能解析不完整" if len(text) < 1500 else ""),
            "evidence": "",
        }
    )

    duplicate_items = []
    for m in duplicate_matches:
        sim = float(m.get("similarity") or 0)
        if sim < 0.25:
            continue
        duplicate_items.append(
            {
                "label": f"与《{m.get('matched_doc_name','')}》存在相似内容",
                "status": "fail" if sim >= 0.55 else "warn",
                "detail": f"最高段落相似度 {sim:.2f}；需人工判断是合理引用、同一团队延续研究还是重复申报。",
                "evidence": f"本子：{truncate(m.get('source_snippet',''), 120)}｜比对：{truncate(m.get('matched_snippet',''), 120)}",
            }
        )
    if not duplicate_items:
        duplicate_items.append(
            {
                "label": "未发现高相似历史文档",
                "status": "pass",
                "detail": "在当前已入库文档范围内未发现相似度超过阈值的段落；入库范围越大，查重越有效。",
                "evidence": "",
            }
        )

    policy_items = []
    if policy_cites:
        # 同一部文件的多条命中只保留「文件 + 条款」不同的组合，避免三行都在引同一部规则
        seen_cites: set[tuple[str, str]] = set()
        for c in policy_cites:
            doc_name = str(c.get("doc_name", "")).strip()
            section = str(c.get("section", "") or "").strip()
            if (doc_name, section) in seen_cites:
                continue
            seen_cites.add((doc_name, section))
            if len(policy_items) >= 3:
                break
            label = f"政策依据：《{doc_name}》{section}" if section else f"政策依据：《{doc_name}》"
            full_text = str(c.get("text", "") or "")
            policy_items.append(
                {
                    "label": label,
                    "status": "warn",
                    "detail": "已检索到可能相关的政策条款，需人工核对适用版本与具体条款。",
                    # evidence 保持短摘要供列表阅读，evidence_full 供「展开全文」；
                    # 只给 180 字会被拦在句中，评审人看不到完整条款
                    "evidence": truncate(full_text, 180),
                    "evidence_full": truncate(full_text, 900),
                }
            )
    elif has_policy_docs:
        policy_items.append(
            {
                "label": "未检索到明显相关政策条款",
                "status": "pass",
                "detail": "已接入政策库，但未检索到与本文明显相关的条款；适用性仍需人工核对。",
                "evidence": "",
            }
        )
    else:
        policy_items.append(
            {
                "label": "政策库未接入",
                "status": "warn",
                "detail": "当前未上传政策文件，仅做通用完整性检查；上传政策库后可启用条款级合规比对。",
                "evidence": "",
            }
        )

    sections = [
        {"key": "completeness", "title": "形式完整性", "status": _overall_status(completeness_items), "items": completeness_items},
        {"key": "integrity", "title": "科研诚信与规范性", "status": _overall_status(integrity_items), "items": integrity_items},
        {"key": "duplicate", "title": "语义查重", "status": _overall_status(duplicate_items), "items": duplicate_items},
        {"key": "policy", "title": "政策合规", "status": _overall_status(policy_items), "items": policy_items},
    ]
    generic_questions = [
        "研究内容、考核指标与经费预算之间是否形成清晰的对应关系？",
        "技术路线的关键节点、数据来源和风险预案是否明确、可执行？",
        "预期成果的署名、知识产权归属和转化路径是否清晰？",
    ]
    for q in generic_questions:
        if q not in questions:
            questions.append(q)
    return sections, questions[:6]


def _risk_level(sections: list[dict]) -> str:
    statuses = [s.get("status") for s in sections]
    if "fail" in statuses:
        return "高"
    if "warn" in statuses:
        return "中"
    return "低"


def _summary(doc: dict, text: str, sections: list[dict], questions: list[str]) -> str:
    fail = sum(1 for s in sections for i in s.get("items", []) if i.get("status") == "fail")
    warn = sum(1 for s in sections for i in s.get("items", []) if i.get("status") == "warn")
    passed = sum(1 for s in sections for i in s.get("items", []) if i.get("status") == "pass")
    return (
        f"文档《{doc['name']}》共 {len(text)} 字。本次预审共检查 {passed + warn + fail} 项："
        f"通过 {passed} 项、需关注 {warn} 项、风险 {fail} 项；"
        f"形成 {len(questions)} 个建议向申报人/评审专家核实的问题。"
    )


def _select_llm_chunks(chunks: list[dict], limit: int = 10) -> list[dict]:
    if len(chunks) <= limit:
        return chunks
    key_terms = [t for sec in REQUIRED_SECTIONS for t in sec["terms"]]
    selected: list[dict] = []
    for c in chunks:
        section = c.get("section") or ""
        if any(t in section for t in key_terms):
            selected.append(c)
        if len(selected) >= limit - 2:
            break
    for c in chunks:
        if c not in selected:
            selected.append(c)
        if len(selected) >= limit:
            break
    return selected[:limit]


def _build_llm_prompt(doc: dict, text: str, chunks: list[dict], duplicate_matches: list[dict], policy_cites: list[dict]) -> list[dict]:
    selected = _select_llm_chunks(chunks)
    context = "\n\n".join(
        f"【本子片段{i}】{c.get('section') or '正文'}\n{truncate(c.get('text',''), 900)}"
        for i, c in enumerate(selected, 1)
    )
    dup_text = "；".join(
        f"与《{m.get('matched_doc_name','')}》相似度 {m.get('similarity',0):.2f}"
        for m in duplicate_matches[:3]
        if float(m.get("similarity") or 0) >= 0.25
    ) or "未发现高相似文档"
    policy_text = "\n".join(
        f"《{c.get('doc_name','')}》{truncate(c.get('text',''), 500)}" for c in policy_cites[:3]
    ) or "未提供政策库"
    system = """你是科研项目评审辅助专家。请对申报书做预审，只输出合法 JSON，不要 Markdown 代码块，不要额外解释。
严格依据提供的本子内容和政策资料，不编造条款、数据或结论；不给出立项结论和评分。
每个判断必须给出 evidence（原文摘录或“未识别到”）。"""
    user = f"""申报书名称：{doc['name']}
文档字数：{len(text)}

【本子内容】
{context}

【系统查重结果】
{dup_text}

【政策资料】
{policy_text}

请输出如下 JSON 结构：
{{
  "summary": "150字以内的总体判断",
  "risk_level": "低|中|高",
  "sections": [
    {{
      "key": "completeness",
      "title": "形式完整性",
      "status": "pass|warn|fail",
      "items": [
        {{"label": "检查项", "status": "pass|warn|fail", "detail": "判断说明", "evidence": "原文摘录或未识别到"}}
      ]
    }},
    {{
      "key": "integrity",
      "title": "科研诚信与规范性",
      "status": "pass|warn|fail",
      "items": []
    }},
    {{
      "key": "policy",
      "title": "政策合规",
      "status": "pass|warn|fail",
      "items": []
    }}
  ],
  "questions": ["建议向申报人或评审专家核实的问题"]
}}

检查要求：形式完整性关注立项背景、研究内容、方法/技术路线、创新点、考核指标、经费预算、团队分工；诚信与规范性关注科研诚信、数据安全、伦理、知识产权、参考文献；政策合规仅在提供了政策资料时做条款级判断，否则说明“政策库未接入”。查重由系统完成，不要编造查重结果。"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _parse_llm_json(text: str) -> dict | None:
    text = (text or "").strip()
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def review_document(doc_id: str) -> dict:
    doc = db.get_document(doc_id)
    if not doc:
        raise ValueError("文档不存在")
    chunks = db.get_chunks(doc_id)
    text = "\n".join(c["text"] for c in chunks)
    if not text.strip():
        raise ValueError("文档没有可用文本，可能解析失败或为扫描件；请上传可复制文本的文件")

    duplicate_matches = retriever.similarity_between_docs(doc_id, top_k=5)
    policy_docs = [d for d in db.list_documents() if d.get("kind") == "policy"]
    policy_cites: list[dict] = []
    if policy_docs:
        # 检索词取自本文，避免所有本子都命中同一批条款（固定关键词串会与正文无关）
        doc_terms = [
            t for t in extract_terms(text, max_terms=10)
            if t not in POLICY_GENERIC_TERMS
        ]
        query = " ".join(doc_terms + POLICY_QUERY_TERMS)
        hits = retriever.search(query, scope=[d["id"] for d in policy_docs], top_k=8)
        # 阈值在检索之后取：万一本次查询向量化失败、索引熔断回 TF-IDF，
        # 阈值也跟着回到 TF-IDF 尺度，否则会把结果一次性卡空
        min_score = _policy_min_score()
        policy_cites = [c for c in hits if float(c.get("score") or 0) >= min_score][:4]
        if hits:
            log.info(
                "政策检索最高分 %.3f（%s，阈值 %.2f）",
                float(hits[0].get("score") or 0),
                "向量" if retriever.uses_embedding else "TF-IDF",
                min_score,
            )

    sections, questions = _heuristic_sections(
        text, doc, duplicate_matches, policy_cites, bool(policy_docs)
    )
    summary = _summary(doc, text, sections, questions) + POLICY_NOTE
    # 政策合规只作提示：无论是否入库都不参与风险等级，否则任何本子恒 ≥「中」
    risk_sections = [s for s in sections if s.get("key") != "policy"]
    risk = _risk_level(risk_sections)
    mode = "offline"
    warning = ""

    if llm.configured:
        try:
            raw = llm.chat(
                _build_llm_prompt(doc, text, chunks, duplicate_matches, policy_cites),
                temperature=0.1,
                max_tokens=1800,
            )
            parsed = _parse_llm_json(raw)
            if parsed and isinstance(parsed.get("sections"), list):
                llm_sections = []
                for sec in parsed["sections"]:
                    if not isinstance(sec, dict):
                        continue
                    # 政策证据和查重来自系统，不能被模型概述或编造结果覆盖。
                    if sec.get("key") in {"policy", "duplicate"}:
                        continue
                    items = []
                    for item in sec.get("items") or []:
                        if not isinstance(item, dict):
                            continue
                        items.append(
                            {
                                "label": str(item.get("label") or "检查项"),
                                "status": _map_status(item.get("status")),
                                "detail": str(item.get("detail") or ""),
                                "evidence": str(item.get("evidence") or ""),
                            }
                        )
                    if items:
                        llm_sections.append(
                            {
                                "key": str(sec.get("key") or "custom"),
                                "title": str(sec.get("title") or "检查项"),
                                "status": _map_status(sec.get("status"), _overall_status(items)),
                                "items": items,
                            }
                        )
                if llm_sections:
                    llm_sections.extend(s for s in sections if s["key"] in {"policy", "duplicate"})
                    sections = llm_sections
                    summary = str(parsed.get("summary") or summary).strip()
                    if "不计入风险等级" not in summary:
                        summary += POLICY_NOTE
                    # 与离线路径同一口径：政策合规只作提示，不参与风险等级
                    section_risk = _risk_level([s for s in sections if s.get("key") != "policy"])
                    risk = _max_risk(_map_risk(parsed.get("risk_level"), section_risk), section_risk)
                    llm_questions = [str(q).strip() for q in (parsed.get("questions") or []) if str(q).strip()]
                    if llm_questions:
                        questions = llm_questions[:8]
                    mode = "qwen"
        except LLMError as exc:
            warning = f"大模型调用失败，已使用规则预审：{exc}"
        except Exception as exc:
            warning = f"大模型结果解析失败，已使用规则预审：{exc}"

    return {
        "doc": {
            "id": doc["id"],
            "name": doc["name"],
            "kind": doc.get("kind"),
            "year": doc.get("year"),
            "char_count": len(text),
            "chunk_count": len(chunks),
        },
        "overall": {
            "summary": summary,
            "risk_level": risk,
            "checked_items": sum(len(s.get("items", [])) for s in sections),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        },
        "sections": sections,
        "duplicate": {"matches": duplicate_matches[:3]},
        "questions": questions,
        "mode": mode,
        "warning": warning,
        "limitations": [] if mode == "qwen" else list(OFFLINE_LIMITATIONS),
        "disclaimer": DISCLAIMER,
    }


def _max_risk(a: str, b: str) -> str:
    order = {"低": 1, "中": 2, "高": 3}
    return a if order.get(a, 0) >= order.get(b, 0) else b


def _map_risk(value: Any, default: str) -> str:
    s = str(value or "").strip().lower()
    if s in {"低", "low", "1"}:
        return "低"
    if s in {"中", "medium", "2"}:
        return "中"
    if s in {"高", "high", "3"}:
        return "高"
    return default
