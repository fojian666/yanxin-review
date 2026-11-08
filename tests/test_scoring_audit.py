import pytest

from rag.review_scoring import build_scorecard, duplicate_coverage
from rag.text import chunk_document


def score(text: str, *, available=True, candidates=None):
    chunks = [{"text": text}]
    return build_scorecard(
        chunks,
        duplicate_coverage(
            chunks,
            candidates or ([[{"text": "完全不同" * 40}]] if available else []),
            available=available,
        ),
    )


def item(result, key):
    return next(entry for dimension in result["dimensions"] for entry in dimension["items"] if entry["key"] == key)


def base_budget(details: str, total: str = "预算总额：10万元") -> str:
    return f"""项目名称：测试
申报单位：测试单位
申报年度：2026
研究内容：测试
技术路线：测试
考核指标：完成报告1份，2028年验收
经费预算
{total}
预算明细：{details}
财政资金：8万元；自筹资金：2万元
"""


def test_duplicate_budget_subjects_are_pending_not_conflict():
    result = score(base_budget("设备费：2万元；设备费：2万元；业务费：3万元；劳务费：3万元"))
    assert item(result, "budget_sum")["status"] == "pending"
    assert not any(issue["key"] == "budget_conflict" for issue in result["critical_issues"])


def test_indicator_intro_and_date_range_are_not_indicators():
    result = score("""研究内容：测试
技术路线：测试
考核指标
本项目考核指标如下：
2026-2028年完成报告2份，2028年验收
""")
    assert item(result, "indicator_quantity")["earned"] == 5
    assert "可识别指标/成果表述1条" in item(result, "indicator_quantity")["detail"]

    date_only = score("""研究内容：测试
技术路线：测试
考核指标
2026-2028年完成报告，2028年验收
""")
    assert item(date_only, "indicator_quantity")["earned"] == 0

    table_header = score("""研究内容：测试
技术路线：测试
考核指标
序号 | 指标名称 | 完成时间 | 验收方式
完成报告2份，2028年验收
""")
    assert "可识别指标/成果表述1条" in item(table_header, "indicator_quantity")["detail"]


def test_method_synonyms_and_negated_indicators():
    synonym = score("""研究内容：测试
技术方案：使用遥感影像
预期研究成果：形成报告1份
""")
    assert not any(issue["key"] == "missing_method" for issue in synonym["critical_issues"])
    assert not any(issue["key"] == "missing_indicators" for issue in synonym["critical_issues"])

    missing = score("""研究内容：测试
实施方案：使用遥感影像
本项目暂无考核指标
""")
    assert any(issue["key"] == "missing_indicators" for issue in missing["critical_issues"])


@pytest.mark.parametrize(
    "label",
    ["项目预算", "总金额", "合计", "总计", "项目总金额", "金额合计", "预算总计"],
)
def test_common_total_aliases(label):
    result = score(base_budget("设备费：2万元；业务费：3万元；劳务费：5万元", f"{label}：10万元"))
    assert item(result, "budget_sum")["status"] == "pass"
    assert item(result, "budget_sources")["status"] == "pass"


@pytest.mark.parametrize(
    "heading",
    [
        "（三）考核指标及预期成果（2026年度）",
        "（三）考核指标（2026年—2028年度）",
    ],
)
def test_annual_indicator_headings_do_not_change_score(heading):
    baseline = score("研究内容：测试\n技术路线：测试\n考核指标\n完成报告3份，2027年验收\n")
    variant = score(f"研究内容：测试\n技术路线：测试\n{heading}\n完成报告3份，2027年验收\n")
    assert variant["earned"] == baseline["earned"]
    assert variant["upper_bound"] == baseline["upper_bound"]
    assert variant["risk_level"] == baseline["risk_level"]


def test_short_text_reuse_items_remain_pending():
    result = score("研究内容：甲")
    assert item(result, "reuse_coverage")["status"] == "pending"
    assert item(result, "reuse_explanation")["status"] == "pending"


@pytest.mark.parametrize("value", ["无", "没有", "待定", "待补充", "不适用"])
def test_negated_data_source_does_not_earn_points(value):
    result = score(f"研究内容：测试\n技术路线：测试\n考核指标：完成报告1份\n数据来源：{value}")
    assert item(result, "data_sources")["earned"] == 0


def test_short_titled_sections_survive_chunking_and_do_not_report_missing():
    chunks = chunk_document([{
        "page": 1,
        "text": """项目名称：短章节测试
申报单位：测试单位
申报年度：2026
研究内容
监测
技术路线
测量
考核指标
报告1份
""",
    }])
    assert any(chunk["section"] == "研究内容" and "监测" in chunk["text"] for chunk in chunks)
    assert any(chunk["section"] == "技术路线" and "测量" in chunk["text"] for chunk in chunks)

    result = build_scorecard(
        chunks,
        duplicate_coverage(chunks, [], available=False),
    )
    critical_keys = {issue["key"] for issue in result["critical_issues"]}
    assert "missing_content" not in critical_keys
    assert "missing_method" not in critical_keys
