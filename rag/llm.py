from __future__ import annotations

import json
import logging
import os
from typing import Generator, Iterable
from urllib.parse import urlparse

import requests

from . import config

logger = logging.getLogger("uvicorn.error")


class LLMError(RuntimeError):
    pass


class LLMClient:
    def __init__(self, info: dict | None = None, strength: str = "default") -> None:
        self.strength = strength
        self.reload(info)

    def reload(self, info: dict | None = None) -> None:
        self.info = dict(config.llm_provider() if info is None else info)
        self.configured = bool(self.info.get("configured"))
        self.base_url = (self.info.get("base_url") or "").rstrip("/")
        self.model = self.info.get("model") or ""
        self.api_key = self.info.get("api_key") or ""
        if self.info.get("blocked_external"):
            logger.warning(
                "检测到公网 LLM 端点，已按“数据不出内网”策略阻止；"
                "确需启用请显式设置 ALLOW_EXTERNAL_LLM=1。"
            )

    def status(self) -> dict:
        return {
            "configured": self.configured,
            "provider": self.info.get("provider", "offline"),
            "label": self.info.get("label", "离线演示模式"),
            "model": self.model if self.configured else "检索式回答（未配置大模型）",
            "base_url": self.base_url if self.configured else "",
            "blocked_external": bool(self.info.get("blocked_external")),
        }

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _payload(self, messages: list[dict], stream: bool, temperature: float, max_tokens: int) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        # 显式配置优先于预设；none 必须能关闭所有供应商扩展参数。
        style = config.LLM_THINKING_STYLE
        if style in {"", "auto"}:
            style = self.info.get("style") or "auto"
        if style == "auto":
            host = (urlparse(self.base_url).hostname or "").lower()
            if "deepseek" in host:
                style = "deepseek"
            elif host == "api.openai.com":
                style = "none"
            else:
                style = "qwen"
        if style == "qwen":
            if config.LLM_ENABLE_THINKING is not None:
                payload["enable_thinking"] = config.LLM_ENABLE_THINKING
        elif style == "deepseek":
            # DeepSeek 默认开思考：JSON 类任务会把 max_tokens 全耗在 reasoning 上，
            # 正文为空。未显式要求时一律关掉。
            if config.LLM_ENABLE_THINKING is not True:
                payload["thinking"] = {"type": "disabled"}
        strength = self.strength
        if strength != "default":
            # 已由聊天目录校验能力；仅覆盖本次请求，不改全局环境或其他任务。
            if self.info["provider"] == "deepseek":
                payload.pop("enable_thinking", None)
                payload["thinking"] = {"type": "disabled" if strength == "quick" else "enabled"}
                if strength != "quick":
                    payload["reasoning_effort"] = strength
                    payload["max_tokens"] = max(max_tokens, {"low": 8192, "high": 16384, "max": 32768}[strength])
            elif self.info["provider"] == "qwen":
                payload.pop("thinking", None)
                payload["enable_thinking"] = strength != "quick"
                if strength != "quick":
                    payload["thinking_budget"] = {"low": 2048, "high": 8192, "max": 16384}[strength]
        return payload

    def chat(
        self,
        messages: list[dict],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        if not self.configured:
            raise LLMError("未配置大模型服务")
        if self.info.get("provider") == "qwen" and self.strength not in {"default", "quick"}:
            return "".join(self.stream_chat(messages, temperature, max_tokens))
        url = f"{self.base_url}/chat/completions"
        payload = self._payload(
            messages,
            False,
            config.LLM_TEMPERATURE if temperature is None else temperature,
            config.LLM_MAX_TOKENS if max_tokens is None else max_tokens,
        )
        try:
            resp = requests.post(
                url,
                headers=self._headers(),
                json=payload,
                timeout=(10, config.LLM_TIMEOUT),
                allow_redirects=False,  # 出口门禁只校验初始地址，跟随重定向等于绕过它
            )
        except requests.RequestException as exc:
            raise LLMError(f"大模型服务连接失败：{exc}") from exc
        if 300 <= resp.status_code < 400:
            raise LLMError(f"大模型端点返回重定向（HTTP {resp.status_code}），已拒绝跟随")
        if resp.status_code >= 400:
            detail = resp.text[:500]
            raise LLMError(f"大模型服务返回 {resp.status_code}：{detail}")
        try:
            data = resp.json()
            message = data["choices"][0]["message"] or {}
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise LLMError(f"大模型返回格式异常：{resp.text[:300]}") from exc
        content = (message.get("content") or "").strip() if isinstance(message, dict) else ""
        if content:
            return content
        if isinstance(message, dict) and message.get("reasoning_content"):
            finish = (data["choices"][0].get("finish_reason") or "").strip()
            if finish == "length":
                raise LLMError(
                    "思考过程耗尽了 max_tokens（finish_reason=length），正文被截断；"
                    "请关闭思考模式（LLM_ENABLE_THINKING=0）或调大 LLM_MAX_TOKENS"
                )
            raise LLMError(
                "大模型仅返回思考内容（reasoning_content）而无正文；"
                "请关闭思考模式（LLM_ENABLE_THINKING=0）或将结果输出到 content 字段"
            )
        raise LLMError("大模型返回了空内容")

    def stream_chat(
        self,
        messages: list[dict],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> Generator[str, None, None]:
        if not self.configured:
            raise LLMError("未配置大模型服务")
        url = f"{self.base_url}/chat/completions"
        payload = self._payload(
            messages,
            True,
            config.LLM_TEMPERATURE if temperature is None else temperature,
            config.LLM_MAX_TOKENS if max_tokens is None else max_tokens,
        )
        try:
            resp = requests.post(
                url,
                headers=self._headers(),
                json=payload,
                timeout=(10, config.LLM_TIMEOUT),
                stream=True,
                allow_redirects=False,  # 同上：307/308 会把原始消息体重放到未校验地址
            )
        except requests.RequestException as exc:
            raise LLMError(f"大模型服务连接失败：{exc}") from exc
        if 300 <= resp.status_code < 400:
            raise LLMError(f"大模型端点返回重定向（HTTP {resp.status_code}），已拒绝跟随")
        if resp.status_code >= 400:
            detail = resp.text[:500]
            raise LLMError(f"大模型服务返回 {resp.status_code}：{detail}")
        emitted = False
        try:
            for raw_line in resp.iter_lines(decode_unicode=True):
                line = (raw_line or "").strip()
                if not line or line.startswith("event:"):
                    continue
                if line.startswith("data:"):
                    line = line[5:].strip()
                if not line:
                    continue
                if line == "[DONE]":
                    break
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                choices = data.get("choices") or []
                if not isinstance(choices, list) or not choices:
                    continue
                first = choices[0] if isinstance(choices[0], dict) else {}
                delta = first.get("delta") or {}
                if not isinstance(delta, dict):
                    continue
                # 思考模型的 delta.reasoning_content 不作为正文输出
                text = delta.get("content")
                if text:
                    emitted = True
                    yield text
        except requests.RequestException as exc:
            raise LLMError(f"大模型流式读取失败：{exc}") from exc
        finally:
            resp.close()
        if not emitted:
            raise LLMError(
                "大模型没有返回正文内容（若用思考型模型，请设 LLM_ENABLE_THINKING=0，"
                "或将结果输出到 content 字段）"
            )


llm = LLMClient()



def generation_info(client, used_model: bool = False, status: str = "complete") -> dict:
    """结果来源快照，仅保留展示字段，不携带密钥或端点。"""
    info = getattr(client, "info", {})
    result = {
        "provider": info.get("provider", "custom") if used_model else "offline",
        "label": info.get("label", "大模型") if used_model else "离线检索",
        "model": getattr(client, "model", "") if used_model else "",
        "status": status,
    }

    if used_model and getattr(client, "strength", "default") != "default":
        result["strength"] = client.strength
    return result


def _chat_catalog(default_client) -> list[tuple[str, dict, str]]:
    """服务端白名单。新增供应商仅用自己的密钥和固定官方端点。"""
    current = dict(default_client.info)
    catalog = [("default", current, ""), ("offline", config._offline(), "")]
    for provider in ("deepseek", "qwen"):
        preset = config._LLM_PRESETS[provider]
        # 当前已验证端点的同供应商密钥不外借到另一个端点。
        same_endpoint = current.get("configured") and current.get("provider") == provider and current.get("base_url", "").rstrip("/") == preset["base_url"]
        names = preset["key_env"]
        if provider == "qwen" and config.QWEN_BASE_URL != config.DASHSCOPE_BASE_URL:
            names = ("DASHSCOPE_API_KEY",)  # 旧 QWEN_* 可能接别家，不能借其 key
        key = current.get("api_key", "") if same_endpoint else next(((os.getenv(n) or "").strip() for n in names if (os.getenv(n) or "").strip()), "")
        reason = "未配置该供应商密钥" if not key else ""
        if not reason and config._is_public_host(preset["base_url"]) and not config.ALLOW_EXTERNAL_LLM:
            reason = "公网出口未授权"
        models = ("deepseek-flash", "deepseek-v4-pro") if provider == "deepseek" else ("qwen-plus",)
        for model in models:
            if same_endpoint and current.get("model") == model:
                continue  # 默认项已经展示这个模型
            info = config._configured(provider, preset["label"], preset["base_url"], model, key, preset["style"])
            catalog.append((model, info, reason))
    return catalog


def _chat_strengths(info: dict) -> list[str]:
    host = (urlparse(info.get("base_url", "")).hostname or "").lower()
    known = (info.get("provider") == "deepseek" and host == "api.deepseek.com" and info.get("model") in {"deepseek-flash", "deepseek-v4-pro"}) or (info.get("provider") == "qwen" and host == "dashscope.aliyuncs.com" and info.get("model") in {"qwen-plus", "qwen-plus-latest"})
    # 显式方言优先；不在端点方言上覆盖管理员配置。
    style = config.LLM_THINKING_STYLE
    supported = style in {"", "auto", info.get("provider")}
    return ["default", "quick", "low", "high", "max"] if known and supported else ["default"]


def chat_options(default_client=None) -> dict:
    client = llm if default_client is None else default_client
    models = []
    for ident, info, reason in _chat_catalog(client):
        models.append({"id": ident, "label": "离线摘录" if ident == "offline" else info.get("label", "大模型"), "model": info.get("model", "") if info.get("configured") else "", "available": not bool(reason), "reason": reason, "strengths": _chat_strengths(info) if info.get("configured") else ["default"]})
    return {"models": models}


def resolve_chat_client(model: str = "default", strength: str = "default", default_client=None):
    client = llm if default_client is None else default_client
    if model == "default" and strength == "default":
        return client
    for ident, info, reason in _chat_catalog(client):
        if ident != model:
            continue
        if reason:
            raise ValueError(reason)
        if info.get("configured") and config._is_public_host(info["base_url"]) and not config.ALLOW_EXTERNAL_LLM:
            raise ValueError("公网出口未授权")
        if strength not in _chat_strengths(info) or (not info.get("configured") and strength != "default"):
            raise ValueError("该模型不支持所选推理强度")
        return LLMClient(info, strength)
    raise ValueError("模型不在可选清单内")
