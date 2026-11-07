import copy
import json

import pytest

from rag import document_access, review
from rag.review_cases import _review_markdown
from rag.review_scoring import build_scorecard, duplicate_coverage, joined_text, normalized_body, risk_band


def score(text, metrics=None):
    chunks = [{"text": text}]
    return build_scorecard(chunks, metrics or duplicate_coverage(chunks, [], available=False))


def item(result, key):
    return next(i for d in result["dimensions"] for i in d["items"] if i["key"] == key)


def test_fixed_weights_pending_and_indicator_proportions():
    result = score("""项目名称：测试课题
申报单位：演示单位
申报年度：2026
一、研究内容
监测地表变化。
二、技术路线
使用遥感影像开展分析。
三、考核指标
（1）2028年完成报告2份，提供第三方验收报告。
（2）完成平台1套，提供测试报告。
四、经费预算
预算需补充。
""")
    assert [d["maximum"] for d in result["dimensions"]] == [20, 20, 20, 15, 10, 15]
    assert sum(d["maximum"] for d in result["dimensions"]) == 100
    assert item(result, "indicator_quantity")["earned"] == 5
    assert item(result, "indicator_units")["earned"] == 5
    assert item(result, "indicator_time")["earned"] == 2.5
    assert item(result, "indicator_acceptance")["earned"] == 5
    assert item(result, "attachments")["status"] == "pending"
    assert result["final_score"] is None
    assert 0 <= result["earned"] <= result["upper_bound"] <= 100
    assert result["upper_bound"] == result["earned"] + result["pending_points"]


def test_enumeration_and_project_word_are_not_quantity_or_units():
    result = score("研究内容：开展测试\n技术路线：分析资料\n考核指标\n（1）该项目建设科学研究管理平台并改善服务。\n")
    assert item(result, "indicator_quantity")["earned"] == 0
    assert item(result, "indicator_units")["earned"] == 0


def test_overlap_and_multiple_peers_do_not_inflate_coverage():
    body = "甲" * 50 + "乙" * 50
    chunks = [{"section": "研究内容", "text": "研究内容\n" + body[:70]},
              {"section": "研究内容", "text": "研究内容\n" + body[50:]}]
    assert joined_text(chunks).count("研究内容") == 1
    source = normalized_body(chunks)
    # Without provenance offsets identical adjacent text is retained conservatively.
    assert source == "研究内容" + body[:70] + body[50:]
    candidate = [{"text": "甲" * 50}]
    metrics = duplicate_coverage(chunks, [candidate, candidate], available=True)
    assert metrics["matched_characters"] == 50
    assert metrics["longest_span"] == 50
    assert metrics["coverage"] == round(50 / len(source), 6)
    assert metrics["coverage"] != 0.55
    result = build_scorecard(chunks, metrics)
    assert item(result, "reuse_coverage")["status"] == "pending"
    assert "matched_doc_id" not in json.dumps(result)


def test_absent_comparison_is_not_a_clean_result():
    chunks = [{"text": "甲" * 60}]
    unavailable = duplicate_coverage(chunks, [], available=False)
    assert unavailable["coverage"] is None
    assert item(build_scorecard(chunks, unavailable), "reuse_coverage")["pending_points"] == 10
    checked = duplicate_coverage(chunks, [[{"text": "乙" * 60}]], available=True)
    assert checked["coverage"] == 0
    assert item(build_scorecard(chunks, checked), "reuse_coverage")["earned"] == 10
    assert "候选" in checked["scope_note"] and "非全库" in checked["scope_note"]


def test_unproven_short_adjacent_overlap_is_retained():
    chunks = [{"idx": 0, "section": "研究内容", "text": "研究内容\n前段正文。尾部七个字符甲"},
              {"idx": 1, "section": "研究内容", "text": "研究内容\n七个字符甲\n后段正文。"}]
    assert joined_text(chunks) == "研究内容\n前段正文。尾部七个字符甲\n七个字符甲\n后段正文。"


def test_independent_hard_split_repetition_is_not_removed():
    chunks = [{"section": "研究内容", "text": "研究内容\n" + "甲" * 700},
              {"section": "研究内容", "text": "研究内容\n" + "甲" * 700}]
    assert normalized_body(chunks) == "研究内容" + "甲" * 1400


def test_indicator_heading_variants_preserve_scoring():
    base = "研究内容\n监测\n技术路线\n测量\n{heading}\n（1）2028年完成报告2份，提供第三方验收报告。\n经费预算\n待补充"
    a = score(base.format(heading="考核指标"))
    b = score(base.format(heading="（三）考核指标与预期成果"))
    for key in ("indicator_quantity", "indicator_units", "indicator_time", "indicator_acceptance"):
        assert item(a, key)["earned"] == item(b, key)["earned"] == 5
    assert (a["earned"], a["upper_bound"], a["risk_level"]) == (b["earned"], b["upper_bound"], b["risk_level"])


def test_evidence_preserves_full_trigger_and_export():
    from rag.review_scoring import scoring_markdown
    result = score("研究内容\n监测\n技术路线\n测量\n考核指标\n完成报告\n经费预算\n测算说明：" + "说明" * 150 + "单价100元")
    basis = item(result, "budget_basis")
    assert basis["earned"] == 3 and "单价100元" not in basis["evidence"]
    assert "单价100元" in basis["evidence_full"]
    assert "单价100元" in "\n".join(scoring_markdown(result))


def test_longest_span_does_not_join_different_sources():
    left, right = "甲" * 24, "乙" * 24
    metrics = duplicate_coverage([{"text": left + right}], [[{"text": left}], [{"text": right}]], available=True)
    assert metrics["matched_characters"] == 48
    assert metrics["longest_span"] == 24


def test_budget_same_currency_conversion_and_conflicts():
    text = """研究内容：监测
技术路线：测量
考核指标：形成监测报告
经费预算
预算总额：10万元
预算明细：设备费：20000元；业务费：3万元；劳务费：5万元
财政补助：8万元
自筹资金：2万元
测算依据：单价100元，数量10次。
"""
    result = score(text)
    assert item(result, "budget_sum")["earned"] == 5
    assert item(result, "budget_sources")["earned"] == 4
    assert not result["critical_issues"]
    conflict = score(text.replace("劳务费：5万元", "劳务费：6万元"))
    assert item(conflict, "budget_sum")["earned"] == 0
    assert conflict["risk_level"] == "高"
    assert any(i["key"] == "budget_conflict" for i in conflict["critical_issues"])
    uncertain = score(text.replace("预算明细：", "预算明细：其中"))
    assert item(uncertain, "budget_sum")["status"] == "pending"
    assert not any(i["key"] == "budget_conflict" for i in uncertain["critical_issues"])
    for suffix in ("\n间接费用：5万元\n间接费用：6万元", "\n间接费用：5"):
        ambiguous = score(text + suffix)
        assert item(ambiguous, "budget_sum")["status"] == "pending"
        assert not any(i["key"] == "budget_conflict" for i in ambiguous["critical_issues"])
    other_fee = score(text.replace("劳务费：5万元", "劳务费：2万元；其他费用：3万元"))
    assert item(other_fee, "budget_sum")["status"] == "pending"
    assert not any(i["key"] == "budget_conflict" for i in other_fee["critical_issues"])
    other_spending = score(text.replace("劳务费：5万元", "劳务费：4万元；其他支出：1万元"))
    assert item(other_spending, "budget_sum")["status"] == "pending"
    assert not any(i["key"] == "budget_conflict" for i in other_spending["critical_issues"])
    other_source = score(text.replace("财政补助：8万元", "财政补助：7万元").replace("自筹资金：2万元", "自筹资金：2万元；其他资金：1万元"))
    assert item(other_source, "budget_sources")["status"] == "pending"
    assert not any(i["key"] == "funding_conflict" for i in other_source["critical_issues"])


@pytest.mark.parametrize("extra", ["其他：1万元", "材料：1万元", "企业配套：1万元", "材料购置1万元", "其他：1"])
def test_unknown_budget_amount_never_claims_conflict(extra):
    text = f"""研究内容\n监测\n技术路线\n测量\n考核指标\n完成报告1份
经费预算
预算总额：10万元
预算明细：设备费：2万元；业务费：3万元；劳务费：4万元；{extra}
财政补助：7万元；自筹资金：2万元；{extra}
"""
    result = score(text)
    assert item(result, "budget_sum")["status"] == "pending"
    assert item(result, "budget_sources")["status"] == "pending"
    assert not any(issue["key"] in {"budget_conflict", "funding_conflict"} for issue in result["critical_issues"])


@pytest.mark.parametrize("extra", ["其他支出 1万", "其他资金 1万", "其他支出 1", "材料费 1万"])
def test_unparsed_budget_numbers_remain_pending(extra):
    result = score(f"研究内容\n监测\n技术路线\n测量\n考核指标\n形成报告\n经费预算\n总经费：10万元\n预算明细：设备费：2万元；业务费：3万元；劳务费：4万元；{extra}\n财政资金：7万元；自筹资金：2万元")
    assert item(result, "budget_sum")["status"] == "pending"
    assert item(result, "budget_sources")["status"] == "pending"
    assert not any(issue["key"] in {"budget_conflict", "funding_conflict"} for issue in result["critical_issues"])


@pytest.mark.parametrize("label", ["总经费", "项目总经费", "项目预算总额", "本项目总经费", "本项目总预算", "项目经费合计"])
def test_budget_total_aliases_are_consistent(label):
    result = score(f"研究内容\n监测\n技术路线\n测量\n考核指标\n形成报告\n经费预算\n{label}：10万元\n预算明细：设备费：2万元；业务费：3万元；劳务费：5万元\n财政资金：8万元；自筹资金：2万元")
    assert item(result, "budget_sum")["status"] == "pass"
    assert item(result, "budget_sources")["status"] == "pass"
    inline_text = score(f"研究内容\n监测\n技术路线\n测量\n考核指标\n形成报告\n经费预算\n{label}：10万元本项目\n预算明细：设备费：2万元；业务费：3万元；劳务费：5万元\n财政资金：8万元；自筹资金：2万元")
    assert item(inline_text, "budget_sum")["status"] == "pass"
    assert item(inline_text, "budget_sources")["status"] == "pass"


def test_budget_nonmonetary_fields_do_not_mask_or_create_conflicts():
    text = "研究内容\n监测\n技术路线\n测量\n考核指标\n形成报告\n经费预算\n总经费：10万元\n预算明细：设备费：2万元；业务费：3万元；劳务费：5万元\n财政资金：8万元；自筹资金：2万元"
    for field in ("数量：10次", "执行期：2026-2028年", "预算年度：2026年", "序号：1", "设备数量：2台", "人员：5人", "编制日期：2026年10月", "间接费用比例：5%", "项目编号：2026-001", "数量：10件", "数量：10份", "人员：5名", "项目周期：3年", "工期：12个月", "研究期限：3年", "实施期：2026年1月至2028年12月", "执行期：2026年1月至2028年12月", "数量：10台（备用）", "设备数量：2套(拟采购)", "执行期：2026年到2028年", "执行期：2026年～2028年", "数量：10吨", "数量：10批", "数量：10幅", "数量：10公里", "数量：10公顷", "数据量：10GB", "样本数：20个", "工作量：5人月", "研究年限：3年", "人员：5名", "实施周期：2026年1月至2028年12月", "数据量：10 TB", "坐标范围：118°-120°", "执行期：\n2026—2028", "数量：\n10株"):
        result = score(text + "\n" + field)
        assert item(result, "budget_sum")["status"] == "pass", field
        assert item(result, "budget_sources")["status"] == "pass", field
        conflict = score(text.replace("劳务费：5万元", "劳务费：4万元") + "\n" + field + "；其他支出：1万")
        assert item(conflict, "budget_sum")["status"] == "pending", field
    for field in ("数量：10台（其他支出1万元）", "数量：10万元", "执行期：2026年至2028年（额外支出1万）", "数量：10台；材料费 1万"):
        result = score(text + "\n" + field)
        assert item(result, "budget_sum")["status"] == "pending", field
        assert item(result, "budget_sources")["status"] == "pending", field
    for unknown in ("其他支出10万元项目", "其他设备费1万元", "其他财政资金1万元"):
        result = score(text + "\n" + unknown)
        assert item(result, "budget_sum")["status"] == "pending", unknown
        assert item(result, "budget_sources")["status"] == "pending", unknown


def test_extended_indicator_heading_does_not_change_score():
    text = "研究内容\n监测\n技术路线\n测量\n考核指标\n形成报告3份，2027年验收\n经费预算\n待补充"
    baseline = score(text)
    for heading in ("（三）考核指标及预期成果与验收方式", "（三）考核指标及预期成果（2028年）", "（三）2028年考核指标及预期成果", "2028年考核指标", "（三）考核指标（2028—2030年）", "（三）考核指标及预期成果（2026-2028年）", "2026年至2028年考核指标", "考核指标（2026年～2028年）", "（三）考核指标（2026—2028）", "（三）考核指标（2026至2028）", "（三）考核指标（2026年1月—2028年12月）", "（三）考核指标及预期成果（2026.01-2028.12）", "2026—2028年度考核指标"):
        variant = score(text.replace("考核指标\n", heading + "\n"))
        assert (baseline["earned"], baseline["upper_bound"], baseline["risk_level"]) == (variant["earned"], variant["upper_bound"], variant["risk_level"]), heading


def test_large_evidence_is_bounded_and_keeps_basis_trigger():
    import json
    text = "研究内容\n监测\n技术路线\n测量\n考核指标\n形成报告\n经费预算\n预算明细：" + "预算说明" * 60000 + "单价100元" + "附加说明" * 60000
    result = score(text)
    items = [item for dimension in result["dimensions"] for item in dimension["items"]]
    assert all(len(item.get("evidence_full", "")) <= 4096 for item in items)
    assert any(item.get("evidence_truncated") for item in items)
    assert "单价100元" in item(result, "budget_basis")["evidence_full"]
    assert len(json.dumps(result, ensure_ascii=False)) < 50000
    distant = score("经费预算\n测算说明：" + "说明" * 5000 + "100元")
    excerpt = item(distant, "budget_basis")["evidence_full"]
    assert "测算说明" in excerpt and "100元" in excerpt and "省略" in excerpt


@pytest.mark.parametrize("lower,upper,expected", [(0, 59.99, "高"), (59.99, 60, "待核验"), (60, 79.99, "中"), (79.99, 80, "待核验"), (80, 100, "低"), (100, 100, "低")])
def test_score_risk_boundaries_and_critical_override(lower, upper, expected):
    assert risk_band(lower, upper, [])[0] == expected
    assert risk_band(lower, upper, [{"key": "budget_conflict"}])[0] == "高"


def test_model_cannot_change_points_or_clear_pending(monkeypatch):
    text = "研究内容：监测\n技术路线：遥感解译\n考核指标：形成报告1份。"
    doc = {"id": "own", "name": "计分测试", "kind": "proposal", "text_len": len(text)}
    monkeypatch.setattr(review.db, "get_document", lambda _: doc)
    monkeypatch.setattr(review.db, "get_chunks", lambda _: [{"text": text}])
    monkeypatch.setattr(review.db, "list_documents", lambda: [])
    monkeypatch.setattr(document_access, "public_ids", lambda: set())
    class Index:
        ready = False
        uses_embedding = False
        def similarity_between_docs(self, *_args, **_kwargs): return []
    monkeypatch.setattr(review, "retriever", Index())
    class Model:
        configured = False
        def chat(self, *_args, **_kwargs):
            return json.dumps({"risk_level": "低", "scoring": {"earned": 100, "pending_points": 0}, "sections": [{"key": "completeness", "status": "pass", "items": [{"label": "模型声称全部通过", "status": "pass"}]}]})
    model = Model()
    monkeypatch.setattr(review, "llm", model)
    offline = review.review_document("own")
    model.configured = True
    online = review.review_document("own")
    assert online["scoring"] == offline["scoring"]
    assert online["scoring"]["pending_points"] > 0
    assert online["overall"]["risk_level"] == offline["overall"]["risk_level"]
    assert online["scoring"]["final_score"] is None


def test_scoring_export_snapshot_and_legacy_compatibility():
    legacy = {"doc": {"name": "历史报告"}, "overall": {"risk_level": "中"}, "sections": []}
    before = copy.deepcopy(legacy)
    assert "规范性检查计分" not in _review_markdown(legacy)
    assert legacy == before
    report = {**legacy, "scoring": score("研究内容：监测\n技术路线：测量\n考核指标：形成报告1份")}
    exported = _review_markdown(report)
    assert "precheck-v1" in exported and "待核验" in exported and "/ 100" in exported
    assert "预算明细与总额一致" in exported
