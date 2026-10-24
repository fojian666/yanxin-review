from __future__ import annotations

import ipaddress
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = Path(os.getenv("DB_PATH", str(DATA_DIR / "app.db")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(30 * 1024 * 1024)))
MAX_CONTENT_CHARS = int(os.getenv("MAX_CONTENT_CHARS", "60000"))
MAX_DOCX_UNCOMPRESSED_BYTES = int(
    os.getenv("MAX_DOCX_UNCOMPRESSED_BYTES", str(120 * 1024 * 1024))
)
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "700"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
TOP_K = int(os.getenv("TOP_K", "7"))
SEED_DEMO_PAPERS = os.getenv("SEED_DEMO_PAPERS", "1") not in {"0", "false", "False"}
# 真实申请书含个人信息，默认不复制入库；仅本机演示时显式开启
SEED_SAMPLE_DOC = os.getenv("SEED_SAMPLE_DOC", "0") not in {"0", "false", "False"}
SAMPLE_DOCX = BASE_DIR / "3.科研课题申请书（终稿）.docx"


def _bind_host() -> str:
    host = (os.getenv("HOST") or "").strip()
    if host:
        return host
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg == "--host" and i + 1 < len(argv):
            return argv[i + 1].strip()
        if arg.startswith("--host="):
            return arg.split("=", 1)[1].strip()
    return "127.0.0.1"


BIND_HOST = _bind_host()


def is_loopback(host: str | None = None) -> bool:
    value = (host or BIND_HOST).strip().lower()
    return value in {"localhost", "::1"} or value.startswith("127.")


_demo_users_opt = (os.getenv("SEED_DEMO_USERS") or "").strip().lower()
# 默认只在本机监听时写入演示账号；对外监听必须显式开启并改密
SEED_DEMO_USERS = (
    is_loopback()
    if not _demo_users_opt
    else _demo_users_opt not in {"0", "false", "no"}
)
DEMO_USER_PASSWORD = (os.getenv("DEMO_USER_PASSWORD") or "").strip()

DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
QWEN_API_KEY = (os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or "").strip()
QWEN_BASE_URL = (os.getenv("QWEN_BASE_URL") or DASHSCOPE_BASE_URL).rstrip("/")
QWEN_MODEL = (os.getenv("QWEN_MODEL") or "qwen-plus").strip()

OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()
OPENAI_BASE_URL = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()

# 数据不出内网：公网模型端点默认阻止，需显式授权
ALLOW_EXTERNAL_LLM = os.getenv("ALLOW_EXTERNAL_LLM", "0") not in {"0", "false", "False"}
# HTTPS 部署时设为 1，会话 Cookie 只经加密连接传输
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") not in {"0", "false", "False"}

LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "90"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1400"))
# None = 不向服务端发送该参数；False/True = 显式关闭/开启 Qwen3 思考模式
_thinking = (os.getenv("LLM_ENABLE_THINKING") or "").strip().lower()
LLM_ENABLE_THINKING: bool | None = (
    None if not _thinking else _thinking not in {"0", "false", "no"}
)

# 外部系统数据推送（/api/ingest/*）的令牌；为空时本机原型不鉴权
INGEST_TOKEN = (os.getenv("INGEST_TOKEN") or "").strip()

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".csv"}
DOC_KINDS = {"auto", "proposal", "policy", "paper", "other"}


def _is_public_host(url: str) -> bool:
    """判断 LLM 端点是否在公网；无法确认时按公网处理（保守）。"""
    host = (urlparse(url).hostname or "").strip().lower()
    if not host:
        return True
    if host in {"localhost", "::1"}:
        return False
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_global
    except ValueError:
        pass
    if host.endswith((".local", ".internal", ".intra", ".lan", ".corp")):
        return False
    # 无点号的裸主机名按内网 DNS 处理；其余域名按公网处理
    return "." in host


def _blocked_external(label: str) -> dict:
    return {
        "configured": False,
        "provider": "offline",
        "label": f"{label}（公网出口已阻止）",
        "base_url": "",
        "model": "检索式回答（未配置千问）",
        "api_key": "",
        "blocked_external": True,
    }


def llm_provider() -> dict:
    explicit_qwen_base = (os.getenv("QWEN_BASE_URL") or "").rstrip("/")
    # An explicitly configured non-DashScope endpoint (vLLM/Ollama) may not
    # require a key; the default DashScope URL without a key is not configured.
    custom_qwen_base = bool(explicit_qwen_base and explicit_qwen_base != DASHSCOPE_BASE_URL)
    if QWEN_API_KEY or custom_qwen_base:
        if _is_public_host(QWEN_BASE_URL) and not ALLOW_EXTERNAL_LLM:
            return _blocked_external("千问公网地址")
        return {
            "configured": True,
            "provider": "qwen",
            "label": "千问 / Qwen",
            "base_url": QWEN_BASE_URL,
            "model": QWEN_MODEL,
            "api_key": QWEN_API_KEY,
            "blocked_external": False,
        }
    if OPENAI_API_KEY:
        if _is_public_host(OPENAI_BASE_URL) and not ALLOW_EXTERNAL_LLM:
            return _blocked_external("OpenAI 兼容公网地址")
        return {
            "configured": True,
            "provider": "openai",
            "label": "OpenAI 兼容接口",
            "base_url": OPENAI_BASE_URL,
            "model": OPENAI_MODEL,
            "api_key": OPENAI_API_KEY,
            "blocked_external": False,
        }
    return {
        "configured": False,
        "provider": "offline",
        "label": "离线演示模式",
        "base_url": "",
        "model": "检索式回答（未配置千问）",
        "api_key": "",
        "blocked_external": False,
    }
