from __future__ import annotations

import json
from typing import Generator, Iterable

import requests

from . import config


class LLMError(RuntimeError):
    pass


class LLMClient:
    def __init__(self) -> None:
        self.reload()

    def reload(self) -> None:
        self.info = config.llm_provider()
        self.configured = bool(self.info.get("configured"))
        self.base_url = (self.info.get("base_url") or "").rstrip("/")
        self.model = self.info.get("model") or ""
        self.api_key = self.info.get("api_key") or ""

    def status(self) -> dict:
        return {
            "configured": self.configured,
            "provider": self.info.get("provider", "offline"),
            "label": self.info.get("label", "离线演示模式"),
            "model": self.model if self.configured else "检索式回答（未配置千问）",
            "base_url": self.base_url if self.configured else "",
        }

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _payload(self, messages: list[dict], stream: bool, temperature: float, max_tokens: int) -> dict:
        return {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }

    def chat(
        self,
        messages: list[dict],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        if not self.configured:
            raise LLMError("未配置千问服务")
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
            )
        except requests.RequestException as exc:
            raise LLMError(f"千问服务连接失败：{exc}") from exc
        if resp.status_code >= 400:
            detail = resp.text[:500]
            raise LLMError(f"千问服务返回 {resp.status_code}：{detail}")
        try:
            data = resp.json()
            return (data["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise LLMError(f"千问返回格式异常：{resp.text[:300]}") from exc

    def stream_chat(
        self,
        messages: list[dict],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> Generator[str, None, None]:
        if not self.configured:
            raise LLMError("未配置千问服务")
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
            )
        except requests.RequestException as exc:
            raise LLMError(f"千问服务连接失败：{exc}") from exc
        if resp.status_code >= 400:
            detail = resp.text[:500]
            raise LLMError(f"千问服务返回 {resp.status_code}：{detail}")
        emitted = False
        try:
            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue
                line = line.strip()
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line == "[DONE]":
                    break
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                choices = data.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                text = delta.get("content")
                if text:
                    emitted = True
                    yield text
        except requests.RequestException as exc:
            raise LLMError(f"千问流式读取失败：{exc}") from exc
        finally:
            resp.close()
        if not emitted:
            raise LLMError("千问没有返回内容")


llm = LLMClient()
