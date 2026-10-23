from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from . import db
from .retrieval import retriever
from .text import extract_keywords, truncate

DISCLAIMER = (
    "本工具为 AI 辅助检查：查重相似度不等于抄袭；专家匹配不替代专家抽取、回避审查和行政审批，"
    "所有结果须由管理人员复核。"
)

HEADER_ALIASES = {
    "name": {"姓名", "name", "专家姓名"},
    "institution": {"单位", "institution", "所在单位"},
    "title": {"职称", "title", "职务职称"},
    "discipline": {"学科", "discipline", "专业", "学科方向"},
    "research_areas": {"研究方向", "research_areas", "areas", "方向"},
    "achievements": {"代表性成果", "achievements", "成果"},
    "avoid_institutions": {"回避单位", "avoid_institutions"},
    "avoid_people": {"回避人员", "avoid_people", "回避专家"},
    "workload": {"在研项目数", "workload", "在研数"},
    "available": {"是否可评审", "available", "可评审"},
}


def _norm_header(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").strip().lower())


def _split_list(value: str) -> list[str]:
    if not value:
        return []
    value = value.replace("；", ";").replace("，", ";").replace("、", ";").replace(",", ";")
    return [item.strip() for item in value.split(";") if item.strip()]


def _parse_bool(value: str, default: bool = True) -> bool:
    text = (value or "").strip().lower()
    if not text:
        return default
    if text in {"1", "true", "yes", "y", "是", "可", "可评审", "启用"}:
        return True
    if text in {"0", "false", "no", "n", "否", "不可", "停用", "不可评审"}:
        return False
    return default


def parse_experts_csv(path) -> list[dict[str, Any]]:
    raw = path.read_bytes()
    text = None
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw.decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV 没有表头")
    mapping: dict[str, str] = {}
    for field in reader.fieldnames:
        key = _norm_header(field)
        for target, aliases in HEADER_ALIASES.items():
            if key in aliases:
                mapping[target] = field
                break
    if "name" not in mapping:
        raise ValueError("CSV 缺少姓名列（姓名/name）")
    experts: list[dict[str, Any]] = []
    for row in reader:
        name = (row.get(mapping["name"]) or "").strip()
        if not name:
            continue
        workload_raw = (row.get(mapping.get("workload", "")) or "").strip()
        workload_match = re.search(r"\d+", workload_raw)
        experts.append(
            {
                "name": name,
                "institution": (row.get(mapping.get("institution", "")) or "").strip(),
                "title": (row.get(mapping.get("title", "")) or "").strip(),
                "discipline": (row.get(mapping.get("discipline", "")) or "").strip(),
                "research_areas": ";".join(
                    _split_list(row.get(mapping.get("research_areas", "")) or "")
                ),
                "achievements": (row.get(mapping.get("achievements", "")) or "").strip(),
                "avoid_institutions": ";".join(
                    _split_list(row.get(mapping.get("avoid_institutions", "")) or "")
                ),
                "avoid_people": ";".join(
                    _split_list(row.get(mapping.get("avoid_people", "")) or "")
                ),
                "workload": int(workload_match.group(0)) if workload_match else 0,
                "available": _parse_bool(row.get(mapping.get("available", "")) or ""),
                "is_sample": 0,
                "source": "csv",
            }
        )
    if not experts:
        raise ValueError("CSV 中没有可用专家行")
    return experts


def _doc_text(doc_id: str) -> tuple[dict, str]:
    doc = db.get_document(doc_id)
    if not doc:
        raise ValueError("文档不存在")
    chunks = db.get_chunks(doc_id)
    text = "\n".join(chunk["text"] for chunk in chunks)
    if not text.strip():
        raise ValueError("文档没有可用文本，无法进行查重/匹配")
    return doc, text


def extract_applicant(text: str) -> dict[str, list[str]]:
    institutions: list[str] = []
    people: list[str] = []
    for line in text.splitlines()[:80]:
        compact = line.strip()
        if not compact:
            continue
        normalized = re.sub(r"\s+", "", compact)
        if "申报单位" in normalized and "主管部门" not in normalized and re.search(r"[:：]", compact):
            value = re.split(r"[:：]", compact, maxsplit=1)[1]
            value = re.sub(r"[（(]盖章[）)]", "", value)
            for item in _split_list(value):
                if len(item) >= 2 and item not in institutions:
                    institutions.append(item)
        if ("负责人" in normalized or "项目负责人" in normalized) and re.search(r"[:：]", compact):
            value = re.split(r"[:：]", compact, maxsplit=1)[1]
            for item in _split_list(value):
                item = re.sub(r"[（(].*?[）)]", "", item).strip()
                if 2 <= len(item) <= 8 and item not in people:
                    people.append(item)
    return {"institutions": institutions, "people": people}


def _exclusion_reason(expert: dict, applicant: dict) -> str:
    if not expert.get("available"):
        return "当前不可评审"
    if int(expert.get("workload") or 0) >= 5:
        return "在研项目数已达上限"
    institution = (expert.get("institution") or "").strip()
    if institution and institution in applicant["institutions"]:
        return "与申报单位存在同单位回避"
    avoid_institutions = _split_list(expert.get("avoid_institutions", ""))
    if any(unit and unit in applicant["institutions"] for unit in avoid_institutions):
        return "命中专家回避单位"
    avoid_people = _split_list(expert.get("avoid_people", ""))
    if any(person and person in applicant["people"] for person in avoid_people):
        return "命中专家回避人员"
    return ""


def match_experts(doc_id: str, top_k: int = 8) -> dict[str, Any]:
    doc, text = _doc_text(doc_id)
    experts = db.list_experts()
    applicant = extract_applicant(text)
    keywords = extract_keywords(text[:20000], topk=18)
    if not experts:
        return {
            "doc": {"id": doc["id"], "name": doc["name"]},
            "proposal_keywords": keywords,
            "applicant": applicant,
            "candidates": [],
            "excluded": [],
            "total_experts": 0,
            "available_count": 0,
            "summary": "专家库为空，请先导入专家 CSV 或保留演示专家。",
            "disclaimer": DISCLAIMER,
        }

    profiles = [
        f"{e.get('discipline','')} {e.get('research_areas','')} {e.get('achievements','')}"
        for e in experts
    ]
    vectorizer = TfidfVectorizer(
        analyzer="char",
        ngram_range=(2, 4),
        sublinear_tf=True,
        max_features=80000,
    )
    matrix = vectorizer.fit_transform([text[:20000]] + profiles)
    similarities = cosine_similarity(matrix[0:1], matrix[1:]).ravel()

    candidates: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    available_count = 0
    for index, expert in enumerate(experts):
        reason = _exclusion_reason(expert, applicant)
        if reason:
            excluded.append(
                {
                    "name": expert["name"],
                    "institution": expert.get("institution", ""),
                    "reason": reason,
                }
            )
            continue
        available_count += 1
        area_blob = f"{expert.get('discipline','')} {expert.get('research_areas','')} {expert.get('achievements','')}"
        hits = [keyword for keyword in keywords if keyword and keyword in area_blob]
        keyword_score = min(1.0, len(hits) / 5)
        discipline_blob = f"{expert.get('discipline','')} {expert.get('research_areas','')}"
        discipline_match = 1.0 if any(k in discipline_blob for k in keywords[:10]) else 0.0
        semantic = float(similarities[index])
        workload = int(expert.get("workload") or 0)
        workload_penalty = min(0.12, workload * 0.02)
        score = 0.55 * semantic + 0.30 * keyword_score + 0.15 * discipline_match - workload_penalty
        score = max(0.0, min(1.0, score))
        reasons = []
        if hits:
            reasons.append(f"方向匹配：{'、'.join(hits[:5])}")
        if expert.get("discipline"):
            reasons.append(f"学科：{expert['discipline']}")
        if expert.get("achievements"):
            reasons.append(f"代表成果：{truncate(expert['achievements'], 50)}")
        reasons.append(f"当前在研 {workload} 项")
        reasons.append("未发现回避冲突")
        candidates.append(
            {
                "expert": expert,
                "score": round(score, 4),
                "semantic": round(semantic, 4),
                "keyword_score": round(keyword_score, 4),
                "discipline_match": int(discipline_match),
                "reasons": reasons,
            }
        )
    candidates.sort(key=lambda item: (-item["score"], -item["semantic"]))
    top = candidates[: max(1, min(int(top_k), 20))]
    top_score = top[0]["score"] if top else 0.0
    for candidate in top:
        candidate["relative_score"] = (
            round(candidate["score"] / top_score, 4) if top_score else 0.0
        )
    summary = (
        f"专家库共 {len(experts)} 位，满足可用/负载/回避约束 {available_count} 位，"
        f"本次推荐 {len(top)} 位候选。"
        if experts
        else "专家库为空。"
    )
    return {
        "doc": {"id": doc["id"], "name": doc["name"]},
        "proposal_keywords": keywords,
        "applicant": applicant,
        "candidates": top,
        "excluded": excluded,
        "total_experts": len(experts),
        "available_count": available_count,
        "summary": summary,
        "disclaimer": DISCLAIMER,
    }


def duplicate_check(doc_id: str, top_k: int = 5) -> dict[str, Any]:
    doc = db.get_document(doc_id)
    if not doc:
        raise ValueError("文档不存在")
    matches = retriever.similarity_between_docs(doc_id, top_k=top_k)
    highest = max((float(m.get("similarity") or 0) for m in matches), default=0.0)
    high = [m for m in matches if float(m.get("similarity") or 0) >= 0.55]
    watch = [m for m in matches if 0.30 <= float(m.get("similarity") or 0) < 0.55]
    if high:
        summary = f"发现 {len(high)} 个高相似文档（最高 {highest:.2f}），需人工复核是否为重复申报或合理引用。"
    elif watch:
        summary = f"发现 {len(watch)} 个需关注文档（最高 {highest:.2f}），建议人工核对相似段落。"
    elif matches:
        summary = f"未发现高相似文档，最高相似度 {highest:.2f}；入库范围越大，查重越有效。"
    else:
        summary = "当前已入库文档范围内未发现相似文档。"
    return {
        "matches": matches,
        "highest": round(highest, 4),
        "high_count": len(high),
        "watch_count": len(watch),
        "summary": summary,
    }


def run_tool_check(doc_id: str, top_k: int = 8) -> dict[str, Any]:
    doc, _text = _doc_text(doc_id)
    return {
        "doc": {"id": doc["id"], "name": doc["name"], "kind": doc.get("kind"), "year": doc.get("year")},
        "duplicate": duplicate_check(doc_id),
        "match": match_experts(doc_id, top_k=top_k),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "disclaimer": DISCLAIMER,
    }
