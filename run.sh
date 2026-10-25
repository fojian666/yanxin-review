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

# 选择解释器：显式 PYTHON > 项目 .venv > conda/Anaconda > 系统 python3，
# 取第一个能导入全部依赖的；若都缺依赖则退回首个可执行者交给下面安装。
find_python() {
  local candidates=() base
  [ -n "${PYTHON:-}" ] && candidates+=("$PYTHON")
  [ -x ".venv/bin/python3" ] && candidates+=(".venv/bin/python3")
  for base in "${CONDA_PREFIX:-}" "$HOME/anaconda3" "$HOME/miniconda3" /opt/anaconda3 /opt/miniconda3; do
    [ -n "$base" ] && [ -x "$base/bin/python3" ] && candidates+=("$base/bin/python3")
  done
  candidates+=("python3")
  for base in "${candidates[@]}"; do
    if "$base" -c "import fastapi, uvicorn, multipart, sklearn, numpy, jieba, dotenv, requests" 2>/dev/null; then
      echo "$base"; return 0
    fi
  done
  for base in "${candidates[@]}"; do
    if "$base" -c "pass" 2>/dev/null; then echo "$base"; return 0; fi
  done
  return 1
}

PY="$(find_python)" || { echo "未找到可用的 Python 解释器，请安装 Python 3.10+"; exit 1; }
echo "使用 Python：${PY}（$("${PY}" -V 2>&1)）"

"${PY}" - <<'PY' || "${PY}" -m pip install -r requirements.txt
import fastapi, uvicorn, multipart, sklearn, numpy, jieba, dotenv, requests
PY

if [ ! -d frontend/dist ]; then
  echo "frontend/dist 不存在，开始安装并构建 React 前端…"
  (cd frontend && npm install && npm run build)
fi

exec "${PY}" -m uvicorn app:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8010}"
