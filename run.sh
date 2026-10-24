#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# .env 中的 HOST/PORT 仅在 shell 未显式设置时生效（其余变量由 Python 端 dotenv 读取）
if [ -f .env ]; then
  if [ -z "${HOST:-}" ]; then
    HOST="$(sed -n 's/^HOST=//p' .env | tail -n 1)"
  fi
  if [ -z "${PORT:-}" ]; then
    PORT="$(sed -n 's/^PORT=//p' .env | tail -n 1)"
  fi
  export HOST PORT
fi

python3 - <<'PY' || python3 -m pip install -r requirements.txt
import fastapi, uvicorn, multipart, sklearn, numpy, jieba, dotenv, requests
PY

if [ ! -d frontend/dist ]; then
  echo "frontend/dist 不存在，开始安装并构建 React 前端…"
  (cd frontend && npm install && npm run build)
fi

exec python3 -m uvicorn app:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8010}"
