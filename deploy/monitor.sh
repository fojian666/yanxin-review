#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8010/api/health}"
SERVICE_NAME="${SERVICE_NAME:-yanxin-review.service}"
DISK_PATH="${DISK_PATH:-/}"
MIN_DISK_PERCENT="${MIN_DISK_PERCENT:-15}"
MIN_MEMORY_MB="${MIN_MEMORY_MB:-120}"
CERT_PATH="${CERT_PATH:-/etc/letsencrypt/live/121-43-160-213.sslip.io/fullchain.pem}"
CERT_MIN_DAYS="${CERT_MIN_DAYS:-21}"

problems=()

if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  problems+=("service=$SERVICE_NAME inactive")
fi

if ! health="$(curl -fsS --max-time 10 "$HEALTH_URL")"; then
  problems+=("health=unreachable")
  health="{}"
fi

if ! printf '%s' "$health" | python3 -c \
  'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("ok") else 1)' \
  >/dev/null 2>&1; then
  problems+=("health=not_ok")
fi

disk_available="$(df -P "$DISK_PATH" | awk 'NR==2 {gsub("%","",$5); print 100-$5}')"
if [[ ! "$disk_available" =~ ^[0-9]+$ ]] || (( disk_available < MIN_DISK_PERCENT )); then
  problems+=("disk_available_percent=$disk_available")
fi

memory_available_mb="$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)"
if [[ ! "$memory_available_mb" =~ ^[0-9]+$ ]] || (( memory_available_mb < MIN_MEMORY_MB )); then
  problems+=("memory_available_mb=$memory_available_mb")
fi

if [[ -f "$CERT_PATH" ]]; then
  if ! openssl x509 -checkend "$((CERT_MIN_DAYS * 86400))" -noout -in "$CERT_PATH" >/dev/null; then
    problems+=("certificate_expires_within_days=$CERT_MIN_DAYS")
  fi
else
  problems+=("certificate_missing=$CERT_PATH")
fi

printf 'time=%s service=%s disk_available_percent=%s memory_available_mb=%s\n' \
  "$(date -Is)" \
  "$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)" \
  "$disk_available" \
  "$memory_available_mb"

if (( ${#problems[@]} )); then
  printf 'unhealthy: %s\n' "${problems[*]}" >&2
  exit 1
fi

printf 'healthy: all checks passed\n'
