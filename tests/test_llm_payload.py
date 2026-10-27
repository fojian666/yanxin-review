"""大模型请求体的「方言」测试：思考模式参数传错，预审就会拿到空正文。

DeepSeek 默认开思考，JSON 任务会把 max_tokens 全花在 reasoning 上；
千问用 enable_thinking，DeepSeek 用 thinking.type。两种不能混发。
"""
from types import SimpleNamespace

from rag import config, llm as llm_module


def _client(base_url: str, monkeypatch) -> llm_module.LLMClient:
    monkeypatch.setattr(
        config,
        "llm_provider",
        lambda: {
            "configured": True,
            "provider": "qwen",
            "label": "测试端点",
            "base_url": base_url,
            "model": "test-model",
            "api_key": "sk-test",
            "blocked_external": False,
        },
    )
    return llm_module.LLMClient()


def _payload(client, monkeypatch, thinking, style="auto"):
    monkeypatch.setattr(config, "LLM_ENABLE_THINKING", thinking)
    monkeypatch.setattr(config, "LLM_THINKING_STYLE", style)
    return client._payload([{"role": "user", "content": "x"}], False, 0.1, 100)


def test_deepseek_disables_thinking_when_unset(monkeypatch):
    """留空时也必须关：默认开思考，JSON 预审会拿到空正文。"""
    client = _client("https://api.deepseek.com/v1", monkeypatch)
    payload = _payload(client, monkeypatch, None)
    assert payload["thinking"] == {"type": "disabled"}
    assert "enable_thinking" not in payload


def test_deepseek_disables_thinking_when_off(monkeypatch):
    client = _client("https://api.deepseek.com/v1", monkeypatch)
    payload = _payload(client, monkeypatch, False)
    assert payload["thinking"] == {"type": "disabled"}
    assert "enable_thinking" not in payload


def test_deepseek_keeps_thinking_when_explicitly_enabled(monkeypatch):
    client = _client("https://api.deepseek.com/v1", monkeypatch)
    payload = _payload(client, monkeypatch, True)
    assert "thinking" not in payload


def test_qwen_uses_enable_thinking_only_when_set(monkeypatch):
    client = _client("https://dashscope.aliyuncs.com/compatible-mode/v1", monkeypatch)
    assert "enable_thinking" not in _payload(client, monkeypatch, None)
    assert _payload(client, monkeypatch, False)["enable_thinking"] is False
    assert "thinking" not in _payload(client, monkeypatch, False)


def test_style_can_force_none(monkeypatch):
    client = _client("https://api.deepseek.com/v1", monkeypatch)
    client.info["style"] = "deepseek"  # 必须覆盖真实预设，不能只测无预设的假客户端
    payload = _payload(client, monkeypatch, False, style="none")
    assert "thinking" not in payload
    assert "enable_thinking" not in payload


def test_style_mismatch_is_not_sent_to_wrong_endpoint(monkeypatch):
    """把 DeepSeek 方言发到千问端点会被 400，所以只能按端点推断或显式指定。"""
    client = _client("https://dashscope.aliyuncs.com/compatible-mode/v1", monkeypatch)
    payload = _payload(client, monkeypatch, False, style="deepseek")
    assert payload["thinking"] == {"type": "disabled"}



def test_openai_preset_omits_vendor_thinking_parameters(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "fake-openai")
    monkeypatch.setenv("LLM_BASE_URL", "")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    monkeypatch.setattr(config, "LLM_THINKING_STYLE", "auto")
    client = llm_module.LLMClient()
    assert client.configured
    for thinking in (None, False, True):
        monkeypatch.setattr(config, "LLM_ENABLE_THINKING", thinking)
        for stream in (False, True):
            payload = client._payload([], stream, 0.1, 100)
            assert "enable_thinking" not in payload and "thinking" not in payload
    # 自定义/auto 端点也能按地址识别 OpenAI。
    client.info["style"] = "auto"
    assert "enable_thinking" not in client._payload([], False, 0.1, 100)
