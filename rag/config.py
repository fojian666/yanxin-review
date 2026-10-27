from __future__ import annotations

import ipaddress
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

_TRUE = {"1", "true", "yes", "on", "y"}
_FALSE = {"0", "false", "no", "off", "n"}


def _env_flag(name: str, default: bool = False) -> bool:
    """布尔环境变量统一解析：认不出的值一律取默认（安全项默认关）。

    旧写法 `os.getenv(..) not in {"0","false","False"}` 会把 `FALSE`/`off` 当成开启，
    对「数据出内网」这类开关是 fail-open。
    """
    raw = (os.getenv(name) or "").strip().lower()
    if raw in _TRUE:
        return True
    if raw in _FALSE:
        return False
    return default

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
MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "2000"))
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "700"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
TOP_K = int(os.getenv("TOP_K", "7"))
SEED_DEMO_PAPERS = _env_flag("SEED_DEMO_PAPERS", True)
SEED_DEMO_PROPOSALS = _env_flag("SEED_DEMO_PROPOSALS", True)
# 真实申请书含个人信息，默认不复制入库；仅本机演示时显式开启
SEED_SAMPLE_DOC = _env_flag("SEED_SAMPLE_DOC", False)
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
ALLOW_EXTERNAL_LLM = _env_flag("ALLOW_EXTERNAL_LLM", False)
# HTTPS 部署时设为 1，会话 Cookie 只经加密连接传输
COOKIE_SECURE = _env_flag("COOKIE_SECURE", False)

LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "90"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1400"))
# None = 不向服务端发送该参数；False/True = 显式关闭/开启 Qwen3 思考模式
_thinking = (os.getenv("LLM_ENABLE_THINKING") or "").strip().lower()
LLM_ENABLE_THINKING: bool | None = (
    None if not _thinking else _thinking not in {"0", "false", "no"}
)
# 思考模式参数的「方言」：不同家叫法不一样，乱传会被 400 或静默忽略
#   显式配置优先于预设；auto 使用预设方言，自定义地址含 deepseek → thinking.type、
#   api.openai.com → 不发扩展参数，其余按千问的 enable_thinking
#   qwen / deepseek 可强制指定，none 表示不发送任何思考相关参数
LLM_THINKING_STYLE = (os.getenv("LLM_THINKING_STYLE") or "auto").strip().lower()

# 外部系统数据推送（/api/ingest/*）的令牌；为空时本机原型不鉴权
INGEST_TOKEN = (os.getenv("INGEST_TOKEN") or "").strip()

# ---- 嵌入（向量）检索 ----
# auto：本地模型可用就用本地，否则有 key 用 API，都没有就退回纯 TF-IDF
EMBED_BACKEND = (os.getenv("EMBED_BACKEND") or "auto").strip().lower()
EMBED_API_KEY = (os.getenv("EMBED_API_KEY") or "").strip()
EMBED_BASE_URL = (os.getenv("EMBED_BASE_URL") or "https://api.siliconflow.cn/v1").rstrip("/")
EMBED_MODEL = (os.getenv("EMBED_MODEL") or "BAAI/bge-m3").strip()
EMBED_BATCH = max(1, int(os.getenv("EMBED_BATCH", "16")))
EMBED_TIMEOUT = int(os.getenv("EMBED_TIMEOUT", "60"))
EMBED_CACHE_DIR = DATA_DIR / "embed_cache"
# 向量余弦下限：低于此值不进结果（等价于「没有相关资料」）。
# 本语料实测：完全无关的问题最高分 0.34~0.44，领域内问题 0.48~0.74，取 0.45 分开。
EMBED_MIN_SCORE = float(os.getenv("EMBED_MIN_SCORE", "0.45"))
# 嵌入同样属于「数据出内网」面：公网端点需显式授权，否则降级为纯 TF-IDF
ALLOW_EXTERNAL_EMBED = _env_flag("ALLOW_EXTERNAL_EMBED", False)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".csv"}
DOC_KINDS = {"auto", "proposal", "policy", "paper", "other"}


def _is_public_host(url: str) -> bool:
    """判断 LLM 端点是否在公网；无法确认时按公网处理（保守）。"""
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").encode("idna").decode("ascii").lower()
        # HTTP 客户端会解码百分号或接受非标准数字 IP；不能当作内网 DNS。
        if parsed.scheme not in {"http", "https"} or not host or "%" in host or "\\" in parsed.netloc:
            return True
        _ = parsed.port  # 非法端口也按无法确认处理
    except (ValueError, UnicodeError):
        return True
    if host in {"localhost", "::1"}:
        return False
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_global
    except ValueError:
        pass
    if re.fullmatch(r"(?:0x[0-9a-f]+|[0-9]+)", host):
        return True
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
        "model": "检索式回答（未配置大模型）",
        "api_key": "",
        "blocked_external": True,
        "style": "",
    }


# 预置供应商：填 LLM_PROVIDER 与对应 key 就能切，不用记各家 base_url/模型名。
# style 决定思考模式参数的方言（见 llm.py），填错会被对方 400。
_LLM_PRESETS: dict[str, dict] = {
    "qwen": {
        "provider": "qwen",
        "label": "千问 / DashScope",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
        "key_env": ("QWEN_API_KEY", "DASHSCOPE_API_KEY"),
        "style": "qwen",
    },
    "deepseek": {
        "provider": "deepseek",
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-flash",
        "key_env": ("DEEPSEEK_API_KEY",),
        "style": "deepseek",
    },
    "openai": {
        "provider": "openai",
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
        "key_env": ("OPENAI_API_KEY",),
        "style": "none",
    },
}


def _offline() -> dict:
    return {
        "configured": False,
        "provider": "offline",
        "label": "离线演示模式",
        "base_url": "",
        "model": "检索式回答（未配置大模型）",
        "api_key": "",
        "blocked_external": False,
        "style": "",
    }


def _configured(provider: str, label: str, base_url: str, model: str, key: str, style: str) -> dict:
    return {
        "configured": True,
        "provider": provider,
        "label": label,
        "base_url": base_url,
        "model": model,
        "api_key": key,
        "blocked_external": False,
        "style": style,
    }


def llm_provider() -> dict:
    """解析当前用哪个模型端点。

    `LLM_PROVIDER` 可选 qwen / deepseek / openai / custom / auto（默认）。
    - 预设：只需给 key，base_url 与模型名用预设值，可用 `LLM_BASE_URL` / `LLM_MODEL` 覆盖；
    - custom：完全按 `QWEN_BASE_URL` / `OPENAI_BASE_URL` 走，适合内网 vLLM / Ollama；
    - auto：维持历史行为，按已配置的 key 依次判断。
    """
    provider = (os.getenv("LLM_PROVIDER") or "auto").strip().lower()
    # 预设模式只认通用覆盖变量：留着旧的 QWEN_BASE_URL 就换供应商，会把 A 家的 key 发到 B 家
    base_override = (os.getenv("LLM_BASE_URL") or "").rstrip("/")
    model_override = (os.getenv("LLM_MODEL") or "").strip()
    override_base = (os.getenv("QWEN_BASE_URL") or "").rstrip("/")
    override_model = (os.getenv("QWEN_MODEL") or "").strip()

    if provider in _LLM_PRESETS:
        preset = _LLM_PRESETS[provider]
        key = next(
            ((os.getenv(name) or "").strip() for name in preset["key_env"] if os.getenv(name)),
            "",
        ) or (os.getenv("LLM_API_KEY") or "").strip()
        base = base_override or preset["base_url"]
        model = model_override or preset["model"]
        if not key:
            return _offline()
        if _is_public_host(base) and not ALLOW_EXTERNAL_LLM:
            return _blocked_external(f"{preset['label']}公网地址")
        return _configured(preset["provider"], preset["label"], base, model, key, preset["style"])

    if provider == "custom":
        key = (os.getenv("LLM_API_KEY") or QWEN_API_KEY or OPENAI_API_KEY).strip()
        base = base_override or override_base or OPENAI_BASE_URL
        model = model_override or override_model or OPENAI_MODEL
        # 内网自建服务往往不要 key，只要给了地址就试
        if not key and not (base and not _is_public_host(base)):
            return _offline()
        if _is_public_host(base) and not ALLOW_EXTERNAL_LLM:
            return _blocked_external("公网模型地址")
        return _configured("custom", "内网 / 自建模型", base, model, key, "auto")

    # auto：保持历史行为（只认模块级变量，兼容旧写法）
    custom_qwen_base = bool(QWEN_BASE_URL and QWEN_BASE_URL != DASHSCOPE_BASE_URL)
    if QWEN_API_KEY or custom_qwen_base:
        if _is_public_host(QWEN_BASE_URL) and not ALLOW_EXTERNAL_LLM:
            return _blocked_external("公网模型地址")
        style = "deepseek" if "deepseek" in QWEN_BASE_URL.lower() else "qwen"
        # 旧 QWEN_* 接口仍可接其他服务；只给已识别的官方端点标供应商。
        host = (urlparse(QWEN_BASE_URL).hostname or "").lower()
        provider, label = "custom", "大模型（OpenAI 兼容）"
        if host == "api.deepseek.com":
            provider, label = "deepseek", "DeepSeek"
        elif host == "dashscope.aliyuncs.com":
            provider, label = "qwen", "千问 / DashScope"
        return _configured(provider, label, QWEN_BASE_URL, QWEN_MODEL, QWEN_API_KEY, style)
    if OPENAI_API_KEY:
        if _is_public_host(OPENAI_BASE_URL) and not ALLOW_EXTERNAL_LLM:
            return _blocked_external("OpenAI 兼容公网地址")
        return _configured("openai", "OpenAI 兼容接口", OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_KEY, "auto")
    return _offline()
