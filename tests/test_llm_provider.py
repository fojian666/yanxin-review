"""模型接入的兜底与切换：既要能换家（千问/DeepSeek/内网），也要在没模型时说实话。

两组约定：
1. `LLM_PROVIDER` 预设只认 `LLM_BASE_URL` / `LLM_MODEL` 覆盖，不认旧的 `QWEN_BASE_URL`
   —— 否则换供应商时会把 A 家的 key 发到 B 家；
2. 没有模型时，报告必须写明「只到规则这一步」，不能让人误以为做过语义判断。
"""
from types import SimpleNamespace

from rag import config, qa as qa_service, review as review_service

LLM_ENV = (
    "LLM_PROVIDER",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_API_KEY",
    "QWEN_API_KEY",
    "QWEN_BASE_URL",
    "QWEN_MODEL",
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "ALLOW_EXTERNAL_LLM",
)


def _clean(monkeypatch):
    for name in LLM_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", False)


def test_qwen_preset_needs_only_a_key(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    monkeypatch.setenv("QWEN_API_KEY", "sk-qwen")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    info = config.llm_provider()
    assert info["configured"] is True
    assert info["provider"] == "qwen"
    assert info["style"] == "qwen"
    assert "dashscope" in info["base_url"]
    assert info["model"] == "qwen-plus"


def test_qwen_preset_without_key_is_offline(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    assert config.llm_provider()["configured"] is False


def test_deepseek_preset_uses_its_own_key_and_style(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-ds")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    info = config.llm_provider()
    assert info["provider"] == "deepseek"
    assert info["style"] == "deepseek"
    assert info["base_url"] == "https://api.deepseek.com/v1"
    assert info["model"] == "deepseek-flash"


def test_preset_ignores_stale_qwen_base(monkeypatch):
    """旧的 QWEN_BASE_URL 留在 .env 里时，切到千问预设不能被它带跑偏。"""
    _clean(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    monkeypatch.setenv("QWEN_API_KEY", "sk-qwen")
    monkeypatch.setenv("QWEN_BASE_URL", "https://api.deepseek.com/v1")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    info = config.llm_provider()
    assert "dashscope" in info["base_url"]


def test_preset_can_be_overridden_generically(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("LLM_MODEL", "deepseek-v4-pro")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-ds")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    assert config.llm_provider()["model"] == "deepseek-v4-pro"


def test_public_endpoint_blocked_without_permission(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    monkeypatch.setenv("QWEN_API_KEY", "sk-qwen")
    info = config.llm_provider()
    assert info["configured"] is False
    assert info["blocked_external"] is True
    assert "出口已阻止" in info["label"]


def test_custom_intranet_endpoint_needs_no_key(monkeypatch):
    """内网 vLLM / Ollama 通常不校验 key，给了地址就该能连。"""
    _clean(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "custom")
    monkeypatch.setenv("LLM_BASE_URL", "http://10.0.0.9:8000/v1")
    info = config.llm_provider()
    assert info["configured"] is True
    assert info["provider"] == "custom"
    assert info["base_url"] == "http://10.0.0.9:8000/v1"


def test_custom_without_address_is_offline(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "custom")
    assert config.llm_provider()["configured"] is False


# ---------- 离线兜底：报告要说清自己做到哪一步 ----------

FAKE_DOC = {"id": "d1", "name": "测试本子", "kind": "proposal", "year": 2026}
FAKE_CHUNKS = [
    {"id": "c1", "doc_id": "d1", "idx": 0, "section": "研究内容",
     "text": "本项目研究内容包括三项：多源影像协同检测、变化图斑提取、业务化验证平台。", "page": 1}
]
LLM_JSON = (
    '{"summary":"整体完整。","risk_level":"中","sections":[{"key":"completeness",'
    '"title":"形式完整性","status":"warn","items":[{"label":"研究内容","status":"warn",'
    '"detail":"需补充指标","evidence":"技术路线未细化"}]}]}'
)


def _fake_db(monkeypatch):
    from rag import db as db_module

    monkeypatch.setattr(db_module, "get_document", lambda doc_id: dict(FAKE_DOC))
    monkeypatch.setattr(db_module, "get_chunks", lambda doc_id: [dict(c) for c in FAKE_CHUNKS])
    monkeypatch.setattr(db_module, "list_documents", lambda: [dict(FAKE_DOC)])
    monkeypatch.setattr(
        review_service.retriever, "similarity_between_docs", lambda doc_id, top_k=5: []
    )
    monkeypatch.setattr(review_service.retriever, "search", lambda *a, **k: [])
    monkeypatch.setattr(
        type(review_service.retriever), "uses_embedding", property(lambda self: False)
    )


def test_offline_review_reports_limitations(monkeypatch):
    """没模型时报告要自带「只到规则这一步」的说明，不能让人以为做过语义判断。"""
    _fake_db(monkeypatch)
    monkeypatch.setattr(review_service, "llm", SimpleNamespace(configured=False))
    report = review_service.review_document("d1")
    assert report["mode"] == "offline"
    assert len(report["limitations"]) == len(review_service.OFFLINE_LIMITATIONS)
    assert any("未启用大模型" in item for item in report["limitations"])
    assert any("字面重合" in item for item in report["limitations"])


def test_llm_review_drops_limitations(monkeypatch):
    _fake_db(monkeypatch)
    monkeypatch.setattr(
        review_service, "llm", SimpleNamespace(configured=True, chat=lambda *a, **k: LLM_JSON)
    )
    report = review_service.review_document("d1")
    assert report["mode"] == "qwen"
    assert report["limitations"] == []
    assert report["sections"]


def test_offline_answer_says_what_it_did_not_do():
    empty = qa_service.fallback_answer("研究内容是什么", [])
    assert "不足以回答" in empty
    body = qa_service.fallback_answer(
        "研究内容是什么",
        [{"doc_id": "d1", "section": "研究内容", "score": 0.5, "idx": 0,
          "text": "本项目研究内容包括三项。第二项是模型构建。"}],
    )
    assert "原文摘录" in body
    assert "未做归纳" in body
