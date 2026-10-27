"""文档漂移不是「记得检查」能解决的，所以让 pytest 一起守。

任何改了代码却没同步文档/软著清单的提交，都会在这里失败。
修法见失败信息：改文档，或跑 `python3 -m tools.soft_copyright` 重新生成清单。
"""
from tools import doc_check


def test_docs_match_code():
    problems = doc_check.check_verbose(False)
    assert not problems, (
        "文档与代码不一致：\n"
        + "\n".join(f"  - {rel}: {msg}" for rel, msg in problems)
        + "\n\n改完再跑 `python3 -m tools.doc_check` 确认；"
        "清单类文件用 `python3 -m tools.soft_copyright` 重新生成。"
    )



def test_env_inventory_covers_indirect_provider_keys(monkeypatch):
    assert "DEEPSEEK_API_KEY" in doc_check.env_vars()
    monkeypatch.setattr(doc_check, "_read", lambda _: 'PRESETS = {"future": {"key_env": ("FUTURE_API_KEY",)}}')
    assert doc_check.env_vars() == ["FUTURE_API_KEY"]
