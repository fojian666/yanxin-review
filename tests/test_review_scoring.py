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
    # The repeated prefix is retained once; overlap is counted once.
    assert source == "研究内容" + body
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


def test_short_adjacent_overlap_is_removed():
    chunks = [{"idx": 0, "section": "研究内容", "text": "研究内容\n前段正文。尾部七个字符甲"},
              {"idx": 1, "section": "研究内容", "text": "研究内容\n七个字符甲\n后段正文。"}]
    assert joined_text(chunks) == "研究内容\n前段正文。尾部七个字符甲\n后段正文。"


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
