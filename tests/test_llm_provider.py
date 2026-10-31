"""模型接入的兜底与切换：既要能换家（千问/DeepSeek/内网），也要在没模型时说实话。

两组约定：
1. `LLM_PROVIDER` 预设只认 `LLM_BASE_URL` / `LLM_MODEL` 覆盖，不认旧的 `QWEN_BASE_URL`
   —— 否则换供应商时会把 A 家的 key 发到 B 家；
2. 没有模型时，报告必须写明「只到规则这一步」，不能让人误以为做过语义判断。
"""
from types import SimpleNamespace

import pytest

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


def test_review_uses_source_char_count_not_overlapping_chunks(monkeypatch):
    doc = {
        "id": "d1", "name": "测试本子", "kind": "proposal", "year": 2026,
        "path": "", "text_len": 1200,
    }
    chunks = [
        {"id": f"c{i}", "doc_id": "d1", "idx": i, "section": "研究内容", "text": "重复内容" * 300}
        for i in range(3)
    ]
    monkeypatch.setattr(review_service.db, "get_document", lambda _id: doc)
    monkeypatch.setattr(review_service.db, "get_chunks", lambda _id: chunks)
    monkeypatch.setattr(review_service.db, "list_documents", lambda: [])
    monkeypatch.setattr(review_service.retriever, "similarity_between_docs", lambda *a, **k: [])
    monkeypatch.setattr(review_service.retriever, "search", lambda *a, **k: [])
    monkeypatch.setattr(review_service, "llm", SimpleNamespace(configured=False))

    report = review_service.review_document("d1")
    completeness = next(section for section in report["sections"] if section["key"] == "integrity")
    count_item = next(item for item in completeness["items"] if item["label"] == "文档完整性")
    assert report["doc"]["char_count"] == 1200
    assert "共 1200 字" in count_item["detail"]
    assert "共 1200 字" in report["overall"]["summary"]
    assert count_item["status"] == "fail"


def test_offline_review_reports_limitations(monkeypatch):
    """没模型时报告要自带「只到规则这一步」的说明，不能让人以为做过语义判断。"""
    _fake_db(monkeypatch)
    monkeypatch.setattr(review_service, "llm", SimpleNamespace(configured=False))
    report = review_service.review_document("d1")
    assert report["mode"] == "offline"
    assert next(s for s in report["sections"] if s["key"] == "duplicate")["title"] == "文本查重"
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


def test_deepseek_never_reuses_qwen_key(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("QWEN_API_KEY", "fake-qwen")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    assert config.llm_provider()["configured"] is False
    monkeypatch.setenv("LLM_API_KEY", "fake-generic")
    assert config.llm_provider()["api_key"] == "fake-generic"



def test_model_review_preserves_system_policy_and_duplicate_evidence(monkeypatch):
    import json

    _fake_db(monkeypatch)
    duplicate = {
        "matched_doc_id": "peer",
        "matched_doc_name": "相近本子",
        "similarity": 0.72,
        "source_snippet": "本子原文",
        "matched_snippet": "对方原文",
    }
    monkeypatch.setattr(review_service.retriever, "similarity_between_docs", lambda *a, **k: [duplicate])
    policy = {"id": "p1", "name": "公开规则", "kind": "policy"}
    cite = {"doc_id": "p1", "doc_name": "公开规则", "section": "第一章 总则 · 第五条",
            "text": "第五条 科研诚信原文。" * 30, "score": 0.9}
    monkeypatch.setattr(review_service.db, "list_documents", lambda: [policy])
    monkeypatch.setattr(review_service.retriever, "search", lambda *a, **k: [cite])
    monkeypatch.setattr(review_service.retriever, "embed_matrix", None)
    monkeypatch.setattr(review_service, "llm", SimpleNamespace(configured=False))
    offline = review_service.review_document("d1")
    payload = json.loads(LLM_JSON)
    payload["sections"] += [
        {"key": key, "title": "模型覆盖", "status": "pass", "items": [
            {"label": "模型声称无需复核", "status": "pass", "evidence": "模型杜撰条款"}]}
        for key in ("policy", "duplicate")
    ]
    monkeypatch.setattr(review_service, "llm", SimpleNamespace(
        configured=True, chat=lambda *a, **k: json.dumps(payload)))
    review_service.llm.info = {"provider": "deepseek", "label": "DeepSeek"}
    review_service.llm.model = "deepseek-flash"
    online = review_service.review_document("d1")
    assert online["mode"] == "qwen"
    assert online["generation"]["model"] == "deepseek-flash"
    assert online["generation"]["provider"] == "deepseek"
    for key in ("policy", "duplicate"):
        before = next(s for s in offline["sections"] if s["key"] == key)
        after = [s for s in online["sections"] if s["key"] == key]
        assert after == [before]
    item = next(s for s in online["sections"] if s["key"] == "policy")["items"][0]
    assert item["evidence_full"] == cite["text"]
    assert item["source_doc_id"] == "p1"
    assert "公开规则" in item["label"] and "第五条" in item["label"]
    assert "人工核对" in item["detail"]
    duplicate_item = next(s for s in online["sections"] if s["key"] == "duplicate")["items"][0]
    assert duplicate_item["source_doc_id"] == "peer"
    assert online["duplicate"]["matches"][0]["matched_doc_id"] == "peer"
    # 模型漏掉 policy 时也必须保留系统证据。
    payload["sections"] = [s for s in payload["sections"] if s["key"] not in {"policy", "duplicate"}]
    missing = review_service.review_document("d1")
    assert next(s for s in missing["sections"] if s["key"] == "policy") == next(
        s for s in offline["sections"] if s["key"] == "policy")
    # 查无条款不能被模型编造。
    monkeypatch.setattr(review_service.retriever, "search", lambda *a, **k: [])
    no_hits = review_service.review_document("d1")
    item = next(s for s in no_hits["sections"] if s["key"] == "policy")["items"][0]
    assert item["label"] == "未检索到明显相关政策条款"
    review_service.llm.info = {"provider": "qwen", "label": "千问 / DashScope"}
    review_service.llm.model = "qwen-plus"
    assert review_service.review_document("d1")["generation"]["provider"] == "qwen"
    def fail(*a, **k):
        from rag.llm import LLMError
        raise LLMError("受控失败")
    review_service.llm.chat = fail
    assert review_service.review_document("d1")["generation"]["status"] == "fallback"
    # 解析中途出错后恢复整份规则结果，不能保留模型章节却标离线。
    payload["questions"] = 1
    review_service.llm.chat = lambda *a, **k: json.dumps(payload)
    malformed = review_service.review_document("d1")
    assert malformed["generation"]["provider"] == "offline"
    assert malformed["generation"]["status"] == "fallback"
    assert malformed["sections"][0]["items"][0]["label"] != "模型检查项"
    assert len(malformed["sections"][0]["items"]) > 1


@pytest.mark.parametrize("provider,label,model", [("deepseek", "DeepSeek", "deepseek-flash"), ("qwen", "千问 / DashScope", "qwen-plus")])
def test_answer_records_actual_model_or_offline(monkeypatch, provider, label, model):
    from rag.llm import LLMError
    prepared = {"mode": "qwen", "messages": [{"role": "user", "content": "测试"}],
                "fallback": "原文摘录", "citations": [], "warning": ""}
    client = SimpleNamespace(configured=True, model=model,
        info={"provider": provider, "label": label, "api_key": "must-not-leak", "base_url": "http://internal"},
        chat=lambda *_: "模型回答")
    monkeypatch.setattr(qa_service, "prepare", lambda *a, **k: prepared)
    monkeypatch.setattr(qa_service, "llm", client)
    result = qa_service.answer("测试")
    assert result["generation"] == {"provider": provider, "label": label, "model": model, "status": "complete"}
    client.info["label"] = "切换后的模型"
    assert result["generation"]["label"] == label  # 历史结果是快照
    def fail(*args):
        raise LLMError("受控失败")
    client.chat = fail
    fallback = qa_service.answer("测试")
    assert fallback["generation"]["provider"] == "offline"
    assert fallback["generation"]["status"] == "fallback"
    assert fallback["generation"]["model"] == ""
    prepared["messages"] = []  # 有配置但没有证据，实际不能调用模型
    assert qa_service.answer("测试")["generation"]["status"] == "complete"


@pytest.mark.parametrize("provider,label,model", [("deepseek", "DeepSeek", "deepseek-flash"), ("qwen", "千问 / DashScope", "qwen-plus")])
def test_stream_records_actual_source_after_fallback_or_interruption(monkeypatch, provider, label, model):
    import asyncio
    import json
    import app as application
    from rag.llm import LLMError
    prepared = {"mode": "qwen", "messages": [{"role": "user", "content": "测试"}],
                "fallback": "离线原文", "citations": [], "warning": ""}
    client = SimpleNamespace(info={"provider": provider, "label": label}, model=model, configured=True)
    client.status = lambda: {**client.info, "model": model, "configured": True}
    monkeypatch.setattr(application.qa, "prepare", lambda *a, **k: prepared)
    monkeypatch.setattr(application, "llm", client)
    async def events():
        response = application.chat_stream(application.ChatRequest(question="测试"))
        return [json.loads(chunk.removeprefix("data: ").strip()) async for chunk in response.body_iterator]
    for outcome in ("success", "fallback", "interrupted"):
        def stream(*args):
            if outcome != "fallback":
                yield "模型正文"
            if outcome != "success":
                raise LLMError("受控中断")
        client.stream_chat = stream
        frames = asyncio.run(events())
        first_source = next(i for i, frame in enumerate(frames) if frame["type"] == "generation")
        first_token = next(i for i, frame in enumerate(frames) if frame["type"] == "token")
        assert first_source < first_token
        actual = frames[-1]["generation"]
        assert actual["status"] == ("complete" if outcome == "success" else outcome)
        assert actual["provider"] == ("offline" if outcome == "fallback" else provider)
        assert actual["model"] == ("" if outcome == "fallback" else model)
        assert "千问调用失败" not in str(frames)
    prepared["messages"] = []
    assert asyncio.run(events())[-1]["generation"]["provider"] == "offline"



def test_legacy_qwen_interface_labels_only_known_providers(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    monkeypatch.setattr(config, "QWEN_API_KEY", "fake-legacy-key")
    for base, provider, label in [("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen", "千问 / DashScope"),
                                  ("https://api.deepseek.com/v1", "deepseek", "DeepSeek"),
                                  ("http://qwen.internal/v1", "custom", "大模型（OpenAI 兼容）")]:
        monkeypatch.setattr(config, "QWEN_BASE_URL", base)
        info = config.llm_provider()
        assert info["label"] == label and info["provider"] == provider
        assert info["configured"]


def test_chat_model_catalog_respects_keys_and_egress(monkeypatch):
    from rag.llm import LLMClient, chat_options, resolve_chat_client
    _clean(monkeypatch)
    monkeypatch.setattr(config, "QWEN_BASE_URL", config.DASHSCOPE_BASE_URL)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "fake-deepseek-key")
    monkeypatch.setenv("QWEN_API_KEY", "fake-qwen-key")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    default = LLMClient(config._offline())
    models = {model["id"]: model for model in chat_options(default)["models"]}
    assert models["deepseek-flash"]["available"]
    assert models["qwen-plus"]["available"]
    assert "fake-" not in str(models) and "base_url" not in str(models)
    deepseek = resolve_chat_client("deepseek-flash", "low", default)
    qwen = resolve_chat_client("qwen-plus", "high", default)
    assert deepseek.api_key == "fake-deepseek-key" and qwen.api_key == "fake-qwen-key"
    assert not default.configured and deepseek.strength == "low" and qwen.strength == "high"
    with pytest.raises(ValueError):
        resolve_chat_client("https://example.com", "default", default)
    with pytest.raises(ValueError):
        resolve_chat_client("offline", "high", default)
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", False)
    assert not next(x for x in chat_options(default)["models"] if x["id"] == "qwen-plus")["available"]
    with pytest.raises(ValueError, match="未授权"):
        resolve_chat_client("qwen-plus", "default", default)


def test_chat_legacy_key_is_not_sent_to_another_vendor(monkeypatch):
    from rag.llm import LLMClient, chat_options
    _clean(monkeypatch)
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    monkeypatch.setattr(config, "QWEN_BASE_URL", "https://api.deepseek.com/v1")
    monkeypatch.setenv("QWEN_API_KEY", "fake-legacy-deepseek-key")
    monkeypatch.setenv("DASHSCOPE_API_KEY", "")
    default = LLMClient(config._configured("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "deepseek-flash", "fake-legacy-deepseek-key", "deepseek"))
    models = {model["id"]: model for model in chat_options(default)["models"]}
    assert not models["qwen-plus"]["available"]
    assert models["deepseek-v4-pro"]["available"]


def test_chat_strength_payloads_are_per_request(monkeypatch):
    from rag.llm import LLMClient, resolve_chat_client, generation_info
    _clean(monkeypatch)
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    monkeypatch.setattr(config, "LLM_THINKING_STYLE", "auto")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "fake-ds")
    monkeypatch.setenv("DASHSCOPE_API_KEY", "fake-qwen")
    monkeypatch.setattr(config, "QWEN_BASE_URL", config.DASHSCOPE_BASE_URL)
    original = LLMClient(config._offline())
    ds = resolve_chat_client("deepseek-flash", "high", original)
    qw = resolve_chat_client("qwen-plus", "low", original)
    deep = ds._payload([], True, 0.2, 1400)
    qwen = qw._payload([], True, 0.2, 1400)
    assert deep["thinking"] == {"type": "enabled"} and deep["reasoning_effort"] == "high"
    assert deep["max_tokens"] >= 16384 and "enable_thinking" not in deep
    assert qwen["enable_thinking"] is True and qwen["thinking_budget"] == 2048
    assert "thinking" not in qwen and "reasoning_effort" not in qwen
    assert generation_info(ds, True)["strength"] == "high"
    assert not original.configured and ds.strength == "high"
    monkeypatch.setattr(config, "LLM_THINKING_STYLE", "none")
    with pytest.raises(ValueError, match="强度"):
        resolve_chat_client("qwen-plus", "low", original)


def test_chat_alternate_model_works_when_default_offline(monkeypatch):
    from rag import llm as llm_module
    _clean(monkeypatch)
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    monkeypatch.setattr(config, "LLM_THINKING_STYLE", "auto")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "fake-ds")
    client = llm_module.resolve_chat_client("deepseek-flash", "quick", llm_module.LLMClient(config._offline()))
    monkeypatch.setattr(qa_service, "prepare", lambda *a, **k: {"mode": "offline", "messages": [{"role": "user", "content": "x"}], "fallback": "原文", "citations": [], "warning": ""})
    monkeypatch.setattr(client, "chat", lambda messages: "受控模型结果")
    result = qa_service.answer("测试", client=client)
    assert result["answer"] == "受控模型结果" and result["generation"]["provider"] == "deepseek"
    assert result["generation"]["strength"] == "quick"


def test_selected_stream_sends_actual_model_and_thinking(monkeypatch):
    import asyncio
    import json
    import app as application
    from rag import llm as llm_module
    _clean(monkeypatch)
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    monkeypatch.setattr(config, "LLM_THINKING_STYLE", "auto")
    monkeypatch.setattr(config, "QWEN_BASE_URL", config.DASHSCOPE_BASE_URL)
    monkeypatch.setenv("DASHSCOPE_API_KEY", "fake-qwen-key")
    monkeypatch.setattr(application, "llm", llm_module.LLMClient(config._offline()))
    monkeypatch.setattr(application.qa, "prepare", lambda *args: {"mode": "offline", "messages": [{"role": "user", "content": "x"}], "fallback": "原文", "citations": [], "warning": ""})
    calls = []
    class Response:
        status_code = 200
        def iter_lines(self, **kwargs):
            yield 'data: {"choices":[{"delta":{"content":"模型回答"}}]}'
            yield 'data: [DONE]'
        def close(self):
            pass
    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        return Response()
    monkeypatch.setattr(llm_module.requests, "post", fake_post)
    async def collect():
        response = application.chat_stream(application.ChatRequest(question="测试", model="qwen-plus", strength="low"))
        return [json.loads(chunk.removeprefix("data: ").strip()) async for chunk in response.body_iterator]
    frames = asyncio.run(collect())
    assert calls[0][0] == config.DASHSCOPE_BASE_URL + "/chat/completions"
    payload = calls[0][1]["json"]
    assert payload["model"] == "qwen-plus" and payload["enable_thinking"] is True and payload["thinking_budget"] == 2048
    assert calls[0][1]["allow_redirects"] is False
    assert frames[-1]["generation"]["provider"] == "qwen" and frames[-1]["generation"]["strength"] == "low"
    assert not application.llm.configured
