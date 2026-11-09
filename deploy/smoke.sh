#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-}"
DEMO_USER="${DEMO_USER:-manager}"
DEMO_PASSWORD="${DEMO_PASSWORD:-}"
REQUIRE_MODEL="${REQUIRE_MODEL:-0}"
RUN_MODEL_SMOKE="${RUN_MODEL_SMOKE:-0}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[[ -n "$BASE_URL" ]] || die "BASE_URL is required"
[[ -n "$DEMO_PASSWORD" ]] || die "DEMO_PASSWORD is required"
command -v python3 >/dev/null || die "python3 is required"

BASE_URL="$BASE_URL" \
DEMO_USER="$DEMO_USER" \
DEMO_PASSWORD="$DEMO_PASSWORD" \
REQUIRE_MODEL="$REQUIRE_MODEL" \
RUN_MODEL_SMOKE="$RUN_MODEL_SMOKE" \
python3 - <<'PY'
import os
import sys

import requests

base = os.environ["BASE_URL"].rstrip("/")
session = requests.Session()

def fail(message):
    print(f"smoke_failed: {message}", file=sys.stderr)
    raise SystemExit(1)

health_response = session.get(f"{base}/api/health", timeout=15)
if health_response.status_code != 200:
    fail(f"/api/health returned {health_response.status_code}")
health = health_response.json()
if not health.get("ok"):
    fail("health payload is not ok")

forbidden = {"base_url", "api_key", "token", "password", "secret"}

def find_forbidden(value, path="health"):
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key.lower() in forbidden:
                found.append(f"{path}.{key}")
            found.extend(find_forbidden(item, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(find_forbidden(item, f"{path}[{index}]"))
    return found

leaks = find_forbidden(health)
if leaks:
    fail(f"health leaks protected fields: {', '.join(leaks)}")

login = session.post(
    f"{base}/api/auth/login",
    json={"username": os.environ["DEMO_USER"], "password": os.environ["DEMO_PASSWORD"]},
    timeout=15,
)
if login.status_code != 200:
    fail(f"login returned {login.status_code}")

routes = [
    "/welcome",
    "/chat",
    "/review-cases",
    "/expert-review",
    "/library",
    "/graph",
    "/trend",
    "/match",
    "/dossiers",
    "/experts",
    "/admin",
]
for route in routes:
    response = session.get(f"{base}{route}", timeout=20, allow_redirects=False)
    if response.status_code != 200:
        fail(f"{route} returned {response.status_code}")

options_response = session.get(f"{base}/api/chat/options", timeout=15)
if options_response.status_code != 200:
    fail(f"/api/chat/options returned {options_response.status_code}")
options = options_response.json()
models = options.get("models", [])
if os.environ["REQUIRE_MODEL"] == "1" and not any(
    item.get("available") and item.get("id") != "offline" for item in models
):
    fail("no configured model is available")

if os.environ["RUN_MODEL_SMOKE"] == "1":
    chat = session.post(
        f"{base}/api/chat",
        json={
            "question": "只回复：模型可用",
            "history": [],
            "scope": [],
            "model": "default",
            "strength": "default",
        },
        timeout=60,
    )
    if chat.status_code != 200:
        fail(f"model smoke returned {chat.status_code}")
    generation = chat.json().get("generation") or {}
    if generation.get("status") != "complete":
        fail(f"model generation status is {generation.get('status')!r}")

print(
    "smoke_ok",
    f"routes={len(routes)}",
    f"models={len(models)}",
    f"provider={health.get('llm', {}).get('provider')}",
)
PY
