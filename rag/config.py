from __future__ import annotations

import os
import sys
from pathlib import Path

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

QWEN_API_KEY = (os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or "").strip()
QWEN_BASE_URL = (os.getenv("QWEN_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
QWEN_MODEL = (os.getenv("QWEN_MODEL") or "qwen-plus").strip()

OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()
OPENAI_BASE_URL = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()

LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "90"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1400"))

# 外部系统数据推送（/api/ingest/*）的令牌；为空时本机原型不鉴权
INGEST_TOKEN = (os.getenv("INGEST_TOKEN") or "").strip()

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".csv"}
DOC_KINDS = {"auto", "proposal", "policy", "paper", "other"}


def llm_provider() -> dict:
    explicit_qwen_base = (os.getenv("QWEN_BASE_URL") or "").rstrip("/")
    # An explicitly configured non-DashScope endpoint (vLLM/Ollama) may not
    # require a key; the default DashScope URL without a key is not configured.
    custom_qwen_base = bool(explicit_qwen_base and explicit_qwen_base != "https://dashscope.aliyuncs.com/compatible-mode/v1")
    if QWEN_API_KEY or custom_qwen_base:
        return {
            "configured": True,
            "provider": "qwen",
            "label": "千问 / Qwen",
            "base_url": QWEN_BASE_URL,
            "model": QWEN_MODEL,
            "api_key": QWEN_API_KEY,
        }
    if OPENAI_API_KEY:
        return {
            "configured": True,
            "provider": "openai",
            "label": "OpenAI 兼容接口",
            "base_url": OPENAI_BASE_URL,
            "model": OPENAI_MODEL,
            "api_key": OPENAI_API_KEY,
        }
    return {
        "configured": False,
        "provider": "offline",
        "label": "离线演示模式",
        "base_url": "",
        "model": "检索式回答（未配置千问）",
        "api_key": "",
    }
