"""Versioned, evidence-based formal checks. Model opinions never assign points."""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from .text import truncate

VERSION = "precheck-v1"
DISCLAIMER = "试行规范性检查分，仅衡量材料表述与可核验程度，不评价科研价值，不构成立项、资助、处罚结论；权重及60/80分界尚需人工样本校准。"
SECTIONS = {
    "background": ("立项背景", "研究背景", "研究目标", "研究意义"),
    "content": ("研究内容", "主要研究内容"),
    "method": ("研究方法", "技术路线", "研究路线", "技术方案", "研究方案", "实施方案"),
    "innovation": ("创新点", "创新之处", "特色与创新", "创新性"),
    "indicators": ("考核指标", "考核目标", "预期成果", "预期研究成果", "成果形式", "提交成果"),
    "budget": ("经费预算", "经费测算", "预算明细", "经费明细"),
    "team": ("研究基础", "承担单位", "主要研究人员", "人员分工", "团队"),
    "integrity": ("科研诚信", "科研伦理", "科技伦理", "数据安全", "保密", "知识产权", "利益冲突"),
}


def joined_text(chunks: list[dict]) -> str:
    """保留无来源偏移信息的正文，避免把巧合重复误认为分块重叠。"""
    parts: list[str] = []
    previous_section = ""
    for chunk in chunks:
        section = str(chunk.get("section") or "").strip()
        body = str(chunk.get("text") or "").strip()
        if section and body.startswith(section + "\n"):
            body = body[len(section):].lstrip()
        if section and section != previous_section:
            parts.append(section)
        if body:
            parts.append(body)
        previous_section = section
    return "\n".join(parts)


def normalized_body(chunks: list[dict]) -> str:
    return "".join(char.lower() for char in joined_text(chunks) if char.isalnum())


def duplicate_coverage(chunks: list[dict], candidates: list[list[dict]], *, available: bool) -> dict:
    """Union exact 24-character runs; no source identifiers or peer text leave here."""
    source = normalized_body(chunks)
    width = 24
    intervals: list[tuple[int, int]] = []
    longest = 0
    if len(source) >= width:
        for candidate in candidates:
            other = normalized_body(candidate)
            grams = {other[i:i + width] for i in range(max(0, len(other) - width + 1))}
            local = [(i, i + width) for i in range(len(source) - width + 1) if source[i:i + width] in grams]
            local_end = local_start = -1
            for start, end in local:
                if start > local_end:
                    local_start = start
                local_end = end
                longest = max(longest, end - local_start)
            intervals.extend(local)
    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    matched = sum(end - start for start, end in merged)
    checked = len(candidates)
    return {
        "coverage": round(matched / len(source), 6) if available and source else None,
        "matched_characters": matched,
        "total_characters": len(source),
        "longest_span": longest,
        "candidates_checked": checked,
        "pending_review": bool(matched) or not available,
        "scope_note": f"仅核对字面检索前{checked}份候选的分块正文；缺少分块来源偏移时保留可能的重叠。忽略空白和标点，连续24个字母、数字或汉字一致计入区间并集。非全库全文重复率，未剔除模板及合理引用，不识别同义改写。",
    }


def _item(key: str, label: str, maximum: float, ratio: float | None, detail: str, evidence: str = "") -> dict:
    earned = round(maximum * max(0, min(1, ratio)), 2) if ratio is not None else 0.0
    bounded = evidence if len(evidence) <= 4096 else evidence[:2000] + "\n[依据过长，中间内容已省略，请核对原文]\n" + evidence[-2000:]
    return {"key": key, "label": label, "maximum": maximum, "earned": earned,
            "pending_points": maximum if ratio is None else 0,
            "status": "pending" if ratio is None else "pass" if earned == maximum else "fail" if earned == 0 else "partial",
            "detail": detail, "evidence": truncate(evidence, 240), "evidence_full": bounded, "evidence_truncated": len(evidence) > 4096}


def _evidence(text: str, pattern: str) -> str:
    for line in text.splitlines():
        if not re.search(pattern, line):
            continue
        if re.search(r"未提供|未说明|待补充|暂无|不承诺|尚未", line):
            continue
        if re.search(r"[:：]\s*(?:无|没有|暂无|待定|待补充|不适用|未知|未设置|n/?a|[-—])\s*(?:[。；;]|$)", line, re.IGNORECASE):
            continue
        return line.strip()
    return ""


def _section_present(text: str, terms: tuple[str, ...]) -> bool:
    for line in text.splitlines():
        for term in terms:
            position = line.find(term)
            if position < 0:
                continue
            before = line[max(0, position - 12):position]
            after = line[position + len(term):position + len(term) + 12]
            if re.search(r"(?:暂无|没有|未设置|未提供|无|待补充|不适用)\s*$", before):
                continue
            if re.match(r"^\s*(?:暂无|没有|未设置|未提供|无内容|待补充|不适用)", after):
                continue
            return True
    return False


def _block(text: str, terms: tuple[str, ...]) -> str:
    lines: list[str] = []
    active = False
    all_terms = tuple(term for group in SECTIONS.values() for term in group)
    for line in text.splitlines():
        heading = len(line.strip()) <= 50 and not re.search(r"[。；;]", line) and any(term in line for term in all_terms)
        if heading:
            active = any(term in line for term in terms)
        if active:
            lines.append(line)
    return "\n".join(lines)


def _dimension(key: str, label: str, items: list[dict]) -> dict:
    return {"key": key, "label": label, "maximum": sum(i["maximum"] for i in items),
            "earned": round(sum(i["earned"] for i in items), 2),
            "pending_points": round(sum(i["pending_points"] for i in items), 2), "items": items}


def risk_band(earned: float, upper: float, critical: list[dict]) -> tuple[str, str]:
    if critical:
        return "高", "存在必须单独核对的关键问题，不能由其他项目得分抵消。"
    def band(value: float) -> str:
        return "低" if value >= 80 else "中" if value >= 60 else "高"
    if band(earned) != band(upper):
        return "待核验", "待核验分值可能改变60/80分档，暂不自动确定风险等级。"
    return band(earned), "按固定规则的已确认得分与最高可能得分落在同一档判定；仍须人工复核。"


def _money_checks(text: str) -> tuple[list[dict], list[dict]]:
    """Only compare explicit flat, non-overlapping money rows with known units."""
    block = _block(text, SECTIONS["budget"])
    amount = r"\s*[:：]\s*(-?\d+(?:\.\d+)?)\s*(万元|元)"
    def money(label: str) -> tuple[Decimal | None, str, bool]:
        prefix = r"(?<![\u4e00-\u9fff])(?:" + label + ")"
        mentions = re.findall(prefix + r"\s*[:：]", block)
        hits = list(re.finditer(prefix + amount, block))
        if len(hits) > 1:
            # 同一标签重复出现时，不能把重复金额折叠成一个值后断言冲突。
            return None, "", True
        values = {Decimal(m[1]) * (10000 if m[2] == "万元" else 1) for m in hits}
        valid = len(values) == 1 and len(hits) == len(mentions)
        return (next(iter(values)), hits[0][0], False) if valid else (None, "", bool(mentions))
    total_names = (
        "总经费", "项目总经费", "本项目总经费",
        "总预算", "项目总预算", "本项目总预算", "项目预算", "预算",
        "项目预算总额", "本项目预算总额", "项目经费合计", "本项目经费合计",
        "总金额", "项目总金额", "金额合计", "预算总计",
        "经费总额", "预算总额", "经费合计", "预算合计",
        "合计", "总计",
    )
    total_labels = set(total_names)
    total, total_evidence, total_ambiguous = money(
        "(?:本项目|项目)?(?:总经费|总预算|总金额|金额合计|预算总计|项目预算|预算|合计|总计|经费总额|预算总额|经费合计|预算合计)"
    )
    leaf = [money(label) for label in ("设备费", "业务费", "劳务费", "间接费用")]
    # 任意无法归入已知口径的金额，都可能是额外科目或资金来源；不能凭
    # 已识别子集断言合计冲突。单价只是测算依据，不属于预算合计科目。
    known = total_labels | {"设备费", "业务费", "劳务费", "间接费用", "财政补助", "财政拨款", "财政资金",
             "自筹资金", "自筹经费", "自筹"}
    nonmoney_label = re.compile(
        r"(?:数量|人数|人员|样本|数据量|工作量|次数|频次|工时|人月|时长|"
        r"执行期|实施期|研究期|项目周期|周期|工期|期限|年限|年度|年份|日期|时间|"
        r"序号|编号|比例|百分比|坐标|范围|面积|体积|容量|重量|距离|长度|高度)"
    )
    monetary_label = re.compile(
        r"(?:总经费|总预算|经费|预算|费用|支出|资金|拨款|补助|金额|成本|"
        r"材料费|设备费|业务费|劳务费|配套|合计|小计|总计)"
    )
    basis_label = re.compile(r"(?<![\u4e00-\u9fff])(?:单价|测算依据|测算说明|费用标准)\s*(?:[:：]|\s)*$")
    known_label = re.compile(
        r"(?<![\u4e00-\u9fff])(?:" + "|".join(sorted((re.escape(value) for value in known), key=len, reverse=True))
        + r")\s*(?:[:：]|\s)*$"
    )
    explicit_money = re.compile(
        r"(?<![\d.])(-?\d+(?:\.\d+)?)\s*(亿元|万元|千元|元|万(?![\u4e00-\u9fffA-Za-z]))"
    )
    classification_block = re.sub(r"([:：])\s*\n\s*", r"\1", block)

    def segment_before(position: int) -> str:
        return re.split(r"[；;，,\n]", classification_block[max(0, position - 80):position])[-1]

    # 预算块里的非金额字段不做枚举豁免。只有明确金额、未知金额字段或无标签
    # 数值才进入待核验，因此吨、批、公顷、GB 等自然资源场景单位无需持续追加白名单。
    ambiguous_amount = False
    for match in explicit_money.finditer(classification_block):
        before = segment_before(match.start())
        if basis_label.search(before) or known_label.search(before):
            continue
        ambiguous_amount = True
        break

    if not ambiguous_amount:
        for segment in re.split(r"[；;，,\n]", classification_block):
            if not re.search(r"(?<!\d)-?\d+(?:\.\d+)?", segment):
                continue
            if re.search(r"(?:亿元|万元|千元|元|万(?![\u4e00-\u9fffA-Za-z]))", segment):
                continue
            field = re.search(r"([\u4e00-\u9fffA-Za-z]{1,30})\s*[:：]", segment)
            label = field[1] if field else ""
            if label and (nonmoney_label.search(label) or basis_label.search(label + "：")):
                continue
            if label and monetary_label.search(label):
                ambiguous_amount = True
                break
            # 无冒号金额行（例如“其他支出 1”）同样是无法可靠归集的口径。
            if re.search(r"(?:总经费|总预算|经费|预算|费用|支出|资金|拨款|补助|金额|成本|配套|合计|小计|总计)\s+-?\d", segment):
                ambiguous_amount = True
                break
            # 明确的日期、时间、比例、编号、序号或数量/单位无需阻断预算核验。
            date = r"20\d{2}(?:\s*年(?:\s*\d{1,2}\s*月)?|\s*[./]\s*\d{1,2}\s*月?)?"
            cleaned = re.sub(rf"{date}\s*(?:[-—–~～至到]\s*{date})?", "", segment)
            cleaned = re.sub(r"(?<![\d.])\d+(?:\.\d+)?\s*(?:年|月|日|时|分|秒|次|人|名|台|套|个|项|篇|份|件|处|期|吨|批|幅|公里|千米|公顷|平方米|GB|TB|%|％)", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"(?:第\s*)?\d+(?:\.\d+)?\s*(?:章|节|条|项)", "", cleaned)
            if not re.search(r"(?<!\d)\d+(?:\.\d+)?(?!\d)", cleaned):
                continue
            ambiguous_amount = True
            break
    # Require the explicit flat detail marker; nested tables are deliberately pending.
    fee_labels = set(re.findall(r"([\u4e00-\u9fff]{1,20}(?:支出|费用|费))\s*[:：]", block))
    unknown_fees = fee_labels - known
    flat = bool(re.search(r"(?:预算明细|经费明细)\s*[:：]", block)) and not re.search(r"其中|直接费用|小计", block) and not unknown_fees and not ambiguous_amount
    parts = [value for value, _, _ in leaf if value is not None]
    critical: list[dict] = []
    ratio = None
    detail = "仅支持明确标注元/万元、带冒号的总额与平铺设备费/业务费/劳务费/间接费用明细；多级预算、缺单位或口径不清时待核验。"
    parsed_complete = flat and not total_ambiguous and not any(ambiguous for _, _, ambiguous in leaf) and total is not None and all(value is not None for value, _, _ in leaf[:3])
    if parsed_complete:
        difference = sum(parts) - total
        ratio = float(abs(difference) <= Decimal("0.01") and all(value >= 0 for value in [total, *parts]))
        detail = f"明细合计{sum(parts):.2f}元，总额{total:.2f}元，差额{difference:.2f}元；允许尾差0.01元。"
        if not ratio:
            critical.append({"key": "budget_conflict", "label": "预算金额不一致", "detail": detail, "evidence": total_evidence})
    rows = [_item("budget_sum", "预算明细与总额一致", 5, ratio, detail, block)]
    fiscal, _, fiscal_ambiguous = money("财政补助|财政拨款|财政资金")
    own, _, own_ambiguous = money("自筹资金|自筹经费|自筹")
    funding_labels = set(re.findall(r"([\u4e00-\u9fff]{1,20}(?:资金|拨款|补助|经费来源))\s*[:：]", block))
    unknown_sources = funding_labels - known
    source_ratio = None if not parsed_complete or fiscal is None or own is None or fiscal_ambiguous or own_ambiguous or unknown_sources else float(abs(fiscal + own - total) <= Decimal("0.01") and fiscal >= 0 and own >= 0)
    source_detail = "需明确财政资金、自筹资金、预算总额及各自单位，未识别完整时待核验。"
    if source_ratio is not None:
        source_detail = f"资金来源合计{fiscal + own:.2f}元，总额{total:.2f}元。"
        if not source_ratio:
            critical.append({"key": "funding_conflict", "label": "资金来源与总额不一致", "detail": source_detail, "evidence": total_evidence})
    rows.append(_item("budget_sources", "资金来源合计一致", 4, source_ratio, source_detail, block))
    rows.append(_item("budget_tasks", "任务与经费对应", 3, None, "任务经费的合理性和对应关系需管理人员核验，模型不自动给分。", block))
    basis = _evidence(block, r"(?:测算依据|测算说明|单价|人月|工时|费用标准).*[0-9]")
    if len(basis) > 4096:
        triggers = list(re.finditer(r"(?:单价|人月|工时|费用标准|测算依据|测算说明).{0,80}?\d+(?:\.\d+)?", basis))
        if triggers:
            position = triggers[-1].start()
            start = max(0, position - 1800)
            basis = ("[前文省略]" if start else "") + basis[start:start + 4000] + ("[后文省略]" if start + 4000 < len(basis) else "")
        else:
            keyword = re.search(r"测算依据|测算说明|单价|人月|工时|费用标准", basis)
            number = re.search(r"\d", basis[keyword.end():]) if keyword else None
            if keyword and number:
                number_pos = keyword.end() + number.start()
                basis = basis[max(0, keyword.start() - 100):keyword.start() + 1000] + "\n[中间内容省略，请核对原文]\n" + basis[max(0, number_pos - 1400):number_pos + 1400]
    rows.append(_item("budget_basis", "提供经费测算依据", 3, float(bool(basis)), "识别带数值的单价、工时或测算依据表述；不证明费用合理或报价真实。" if basis else "未识别到带数值的测算依据。", basis))
    return rows, critical


def build_scorecard(chunks: list[dict], metrics: dict) -> dict[str, Any]:
    text = joined_text(chunks)
    fields = [bool(_evidence(text, pattern)) for pattern in (
        r"(?:项目名称|课题名称)\s*[:：]\s*\S+", r"(?:申报单位|承担单位)\s*[:：]\s*\S+", r"(?:申报年份|申报年度)\s*[:：]\s*20\d{2}",
    )]
    section_hits = {key: _section_present(text, terms) for key, terms in SECTIONS.items()}
    critical = [{"key": "missing_" + key, "label": label + "未识别", "detail": "未识别到关键章节或对应表述，请核对原文与解析结果。", "evidence": ""}
                for key, label in (("content", "研究内容"), ("method", "技术路线"), ("indicators", "考核指标")) if not section_hits[key]]
    materials = _dimension("materials", "材料与信息完整性", [
        _item("required_fields", "项目名、申报单位与申报年度", 6, sum(fields) / 3, f"识别{sum(fields)}/3个字段，每项2分；仅核对表述存在，不证明身份真实。"),
        _item("attachments", "必需附件核验", 6, None, "当前预审仅收到选中材料，未获得完整、获准核验的申报材料包，附件齐备、签字及盖章须人工核验。"),
        _item("required_sections", "八类章节表述", 8, sum(section_hits.values()) / 8, f"识别{sum(section_hits.values())}/8类表述，每类1分；出现关键词不代表章节质量达标。", "未识别：" + "、".join(SECTIONS[key][0] for key, found in section_hits.items() if not found) if not all(section_hits.values()) else "八类章节均识别到相应表述。"),
    ])
    data = _evidence(text, r"数据来源|来源包括|来自.+(?:数据|影像|资料)|收集.+(?:数据|影像|资料)|采用.+(?:影像|数据库)")
    schedule = _evidence(text, r"(?:进度安排|年度安排|实施计划|研究计划).*(?:20\d{2}|季度|个月|第.+年)")
    route = _dimension("route", "研究任务与技术路线", [
        _item("goal_tasks", "目标与任务对应", 6, None, "目标与任务的实质对应关系需专家核验，不因关键词共现自动得分。", _block(text, SECTIONS["content"])),
        _item("task_methods", "任务与方法对应", 6, None, "方法是否支撑各项任务需专家核验，模型仅补充疑点和证据。", _block(text, SECTIONS["method"])),
        _item("data_sources", "说明数据来源", 4, float(bool(data)), "识别到数据来源表述，不证明数据权属、可获得性或真实性。" if data else "未识别到明确的数据来源表述。", data),
        _item("schedule", "提供带时间的进度安排", 4, float(bool(schedule)), "识别到进度及时间表述；计划可行性仍须人工核验。" if schedule else "未识别到带年份、季度或时长的研究计划。", schedule),
    ])
    indicator_block = _block(text, SECTIONS["indicators"])
    targets = []
    for line in re.split(r"[；;\n]", indicator_block):
        line = re.sub(r"^\s*(?:[（(]\s*[一二三四五六七八九十\d]+\s*[）)]|[一二三四五六七八九十\d]+[、.．])\s*", "", line.strip())
        # 章节标题先整体剥离，再判断是否还有指标正文。这样无需枚举
        # “2026—2028”“2026至2028”“2026年1月—2028年12月”等日期写法。
        date = r"20\d{2}\s*(?:年度|年(?:\s*\d{1,2}\s*月)?|[./]\s*\d{1,2}\s*月?)?"
        heading = re.sub(
            rf"[（(]?\s*{date}\s*(?:[-—–~～至到]\s*{date})?\s*(?:年度)?\s*[）)]?",
            "",
            line,
        ).strip()
        heading = re.sub(r"^[年度]{1,2}\s*", "", heading)
        heading = re.sub(r"^[（(]\s*[）)]\s*", "", heading).strip()
        prefix = (
            r"^(?:考核指标(?:(?:及|与)预期成果)?(?:(?:及|与)(?:验收方式|验证方式))?"
            r"|预期成果(?:(?:及|与)考核指标)?(?:(?:及|与)(?:验收方式|验证方式))?"
            r"|成果形式|提交成果)"
        )
        heading_body = heading
        if re.match(prefix, heading_body):
            heading_body = re.sub(prefix, "", heading_body).strip()
            heading_body = heading_body.strip("（）()[]【】:：-—–~～ ")
            heading_body = re.sub(
                r"^(?:(?:及|与|和)?(?:验收方式|验证方式|说明|预期成果))+$",
                "",
                heading_body,
            )
            if not heading_body:
                continue
        compact_heading = re.sub(r"\s+", "", heading_body)
        if (
            compact_heading.endswith(("：", ":"))
            and not re.search(r"\d|完成|形成|提交|取得|发表|申获|建立|构建|通过|达到", compact_heading)
        ):
            continue
        if (
            re.search(r"[|｜]", compact_heading)
            and re.search(r"序号|指标名称|成果名称|完成时间|验收方式", compact_heading)
            and not re.search(r"\d+\s*(?:套|项|篇|份|个|处|期|件|%|％)", compact_heading)
        ):
            continue
        if re.fullmatch(r"(?:本项目|本课题|项目)?(?:拟设|设置|列明)?考核(?:指标|目标)(?:如下)?[:：]?", compact_heading):
            continue
        if compact_heading in {"考核指标", "预期成果", "考核目标", "预期研究成果", "成果形式", "提交成果"}:
            continue
        if any(term in compact_heading for term in SECTIONS["indicators"]) and not _section_present(compact_heading, SECTIONS["indicators"]):
            continue
        line = re.sub(r"^(?:考核指标(?:与预期成果)?|预期成果(?:及考核指标)?|成果形式|提交成果)\s*[:：]?\s*", "", line)
        if len(line) > 8 and line not in targets:
            targets.append(line)
    targets = targets[:100]
    patterns = (
        ("indicator_quantity", "指标明确数值", r"(?<!\d)(?!20\d{2}\s*年)\d+(?:\.\d+)?|[一二三四五六七八九十两]+\s*(?:套|项|篇|份|个|处|期)"),
        ("indicator_units", "指标明确单位", r"(?:\d+(?:\.\d+)?|[一二三四五六七八九十两]+)\s*(?:%|％|套|项|篇|份|个|处|期|件|人次|公顷|平方米|公里|千米|毫米|米|条|次)"),
        ("indicator_time", "指标明确完成时间", r"20\d{2}\s*年|季度|年度|第[一二三四五六七八九十\d]+年|结题前|验收前|项目结束前|实施期内|截至"),
        ("indicator_acceptance", "指标明确验收方式", r"验收|测试|检测|核验|评测|抽检|审查|评审|查新|检索证明|登记证书|授权证书|第三方|提交.*报告|提供.*(?:证明|报告|清单)"),
    )
    indicator_items = []
    date_range = rf"(?:{date})\s*(?:[-—–~～至到]\s*(?:{date}))?"
    measurable_targets = [re.sub(date_range, "", line).strip() for line in targets]
    for key, label, pattern in patterns:
        candidate_lines = measurable_targets if key == "indicator_quantity" else targets
        passed = [line for line in candidate_lines if re.search(pattern, line)]
        indicator_items.append(_item(key, label, 5, len(passed) / len(targets) if targets else None,
                                     f"可识别指标/成果表述{len(targets)}条，其中{len(passed)}条满足本项；5×{len(passed)}/{len(targets)}。" if targets else "未能可靠分离指标条目，本项待核验。", "\n".join(passed)))
    budget_items, budget_critical = _money_checks(text)
    critical.extend(budget_critical)
    integrity_items = []
    for key, label, weight, pattern in (
        ("pledge", "科研诚信承诺表述", 3, r"承诺.*(?:科研诚信|真实|诚信)|遵守.*科研诚信|科研诚信.*(?:承诺|保证|杜绝)"),
        ("data_security", "数据安全措施表述", 4, r"脱敏|加密|权限控制|访问控制|分级授权|保密协议|数据分级|内网存储"),
        ("intellectual_property", "知识产权归属说明", 3, r"(?:知识产权|成果归属).*(?:归属|所有|共有|约定|许可|协议)"),
    ):
        evidence = _evidence(text, pattern)
        integrity_items.append(_item(key, label, weight, float(bool(evidence)), "仅识别具体表述，不核验承诺、措施或权属真实性。" if evidence else "未识别到对应的具体承诺或措施表述。", evidence))
    reuse_insufficient = len(normalized_body(chunks)) < 24
    reuse_pending = metrics.get("pending_review", True) or reuse_insufficient
    refs = bool(re.search(r"参考文献|\[\d{1,3}\]", text))
    reuse = _dimension("reuse", "文本复用核对", [
        _item("reuse_coverage", "字面复用范围核对", 10, None if reuse_pending else 1,
              "正文为空或有效字符不足24个，无法可靠计算复用范围，本项待核验。" if reuse_insufficient else
              "存在疑似一致片段，尚未人工区分引用、模板和未说明复用，10分待核验，不按最高余弦扣分。" if metrics.get("matched_characters") else "候选检查尚不足以计算复用范围，本项待核验。" if reuse_pending else "在已核对的有限候选内未发现连续24字符一致片段；不代表全库无重复。"),
        _item("reference_markers", "引用标注线索", 2, float(refs), "识别到参考文献标题或编号引用；不证明引用真实、完整或适当。" if refs else "未识别到参考文献或编号引用。"),
        _item("reuse_explanation", "引用及模板复核", 3, None if reuse_pending else 1, "疑似片段的合理引用、授权和模板范围须人工核验。" if reuse_pending else "当前有限候选未产生待解释的一致片段。"),
    ])
    dimensions = [materials, route, _dimension("indicators", "考核指标可核验性", indicator_items),
                  _dimension("budget", "经费预算一致性", budget_items), _dimension("integrity", "科研诚信与安全说明", integrity_items), reuse]
    earned = round(sum(d["earned"] for d in dimensions), 2)
    pending = round(sum(d["pending_points"] for d in dimensions), 2)
    upper = round(earned + pending, 2)
    risk, reason = risk_band(earned, upper, critical)
    return {"version": VERSION, "label": "规范性检查（试行）", "maximum": 100, "earned": earned,
            "pending_points": pending, "upper_bound": upper, "final_score": earned if not pending else None,
            "risk_level": risk, "risk_reason": reason, "critical_issues": critical, "dimensions": dimensions,
            "disclaimer": DISCLAIMER, "thresholds": {"low": 80, "medium": 60}, "duplicate_metrics": metrics}


def scoring_markdown(scoring: dict | None) -> list[str]:
    if not scoring:
        return []
    score = str(scoring["final_score"]) if scoring.get("final_score") is not None else f"{scoring['earned']}–{scoring['upper_bound']}"
    lines = ["## 规范性检查计分（试行）", f"- 规则版本：{scoring['version']}", f"- 检查分：{score} / 100",
             f"- 待核验分值：{scoring['pending_points']}", f"- 分档依据：{scoring['risk_reason']}", scoring["disclaimer"], ""]
    for issue in scoring.get("critical_issues", []):
        lines.append(f"- 关键问题：{issue['label']}；{issue['detail']}")
    for dimension in scoring["dimensions"]:
        lines.append(f"### {dimension['label']}（已确认{dimension['earned']} / {dimension['maximum']}，待核验{dimension['pending_points']}）")
        for item in dimension["items"]:
            lines.append(f"- {item['label']}：已确认{item['earned']} / {item['maximum']}，待核验{item['pending_points']}；{item['detail']}")
            if item.get("evidence_full") or item.get("evidence"):
                lines.append(f"  - 依据：{item.get('evidence_full') or item['evidence']}")
    metrics = scoring.get("duplicate_metrics") or {}
    if metrics:
        coverage = "待核验" if metrics.get("coverage") is None else f"{metrics['coverage']:.2%}"
        lines.extend(["", f"- 候选疑似字面覆盖率：{coverage}（非全文重复率）", metrics.get("scope_note", "")])
    return lines + [""]
