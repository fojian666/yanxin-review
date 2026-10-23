from __future__ import annotations

import os
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
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "700"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
TOP_K = int(os.getenv("TOP_K", "7"))
SEED_DEMO_PAPERS = os.getenv("SEED_DEMO_PAPERS", "1") not in {"0", "false", "False"}
SEED_SAMPLE_DOC = os.getenv("SEED_SAMPLE_DOC", "1") not in {"0", "false", "False"}
SAMPLE_DOCX = BASE_DIR / "3.科研课题申请书（终稿）.docx"

QWEN_API_KEY = (os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or "").strip()
QWEN_BASE_URL = (os.getenv("QWEN_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
QWEN_MODEL = (os.getenv("QWEN_MODEL") or "qwen-plus").strip()

OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()
OPENAI_BASE_URL = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()

LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "90"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1400"))

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
