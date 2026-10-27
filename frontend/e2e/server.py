"""E2E 子进程入口：只允许临时目录，随机回环端口，不接触开发库。"""
import json
import os
from pathlib import Path
import socket
import shutil
import sys
import tempfile

root = Path(__file__).resolve().parents[2]
data = Path(sys.argv[1]).resolve()
if data.parent != Path(tempfile.gettempdir()).resolve() or not data.name.startswith("yanxin-e2e-"):
    raise SystemExit("E2E 数据目录必须为系统临时目录下的 yanxin-e2e-* 目录")
sys.path.insert(0, str(root))
# load_dotenv 不会覆盖现有值；显式置空防止工作区 .env 注入模型凭证。
for name in (
    "LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "QWEN_API_KEY",
    "DASHSCOPE_API_KEY", "QWEN_BASE_URL", "QWEN_MODEL", "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "EMBED_API_KEY", "EMBED_BASE_URL",
):
    os.environ[name] = ""
os.environ.update({
    "DATA_DIR": str(data), "DB_PATH": str(data / "app.db"), "HOST": "127.0.0.1",
    "EMBED_BACKEND": "none", "ALLOW_EXTERNAL_EMBED": "0", "ALLOW_EXTERNAL_LLM": "0",
    "SEED_SAMPLE_DOC": "0", "SEED_DEMO_USERS": "1", "SEED_DEMO_PAPERS": "1",
    "SEED_DEMO_PROPOSALS": "1", "DEMO_USER_PASSWORD": "yanxin2026",
    "COOKIE_SECURE": "0", "INGEST_TOKEN": "e2e-only-token",
})
from rag import db
from rag.corpus import load_policies
import uvicorn

db.init_db()
load_policies()
# 快照构建产物，避免其他 harness 重建 dist 时改变正在测试的资源。
ui = data / "ui"
shutil.copytree(root / "frontend" / "dist", ui)
import app as app_module
from starlette.staticfiles import StaticFiles
app_module.DIST_DIR = ui
for route in app_module.app.routes:
    if getattr(route, "path", "") == "/assets":
        route.app = StaticFiles(directory=ui / "assets")
# 由操作系统分配并保留端口，避免“探测空闲端口后释放”的竞争窗口。
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    print(json.dumps({"e2e_url": f"http://127.0.0.1:{listener.getsockname()[1]}"}), flush=True)
    server = uvicorn.Server(uvicorn.Config(app_module.app, host="127.0.0.1", log_level="warning"))
    server.run(sockets=[listener])
