#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-yanxin}"
APP_DIR="${APP_DIR:-/opt/yanxin-review}"
CONF_DIR="${CONF_DIR:-/etc/yanxin-review}"
DATA_DIR="${DATA_DIR:-/var/lib/yanxin-review/data}"
SERVER_NAME="${SERVER_NAME:-}"
CERT_NAME="${CERT_NAME:-}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || die "run as root"
command -v git >/dev/null || die "git is required"
command -v python3 >/dev/null || die "python3 is required"

source_dir="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
[[ -n "$source_dir" ]] || die "run from a Git checkout"
git config --global --add safe.directory "$source_dir"

if [[ "$(git -C "$source_dir" status --porcelain)" != "" ]]; then
  die "refusing to deploy a dirty worktree; commit or stash changes first"
fi

id "$APP_USER" >/dev/null 2>&1 || useradd \
  --system \
  --home-dir "/var/lib/yanxin-review" \
  --create-home \
  --shell /usr/sbin/nologin \
  "$APP_USER"

install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR"
install -d -m 700 -o root -g root "$CONF_DIR"

if [[ ! -f "$CONF_DIR/app.env" ]]; then
  die "missing $CONF_DIR/app.env; create it from .env.example first"
fi
chown root:root "$CONF_DIR/app.env"
chmod 600 "$CONF_DIR/app.env"

archive="$(mktemp /tmp/yanxin-source.XXXXXX.tar)"
stage="$(mktemp -d /tmp/yanxin-source.XXXXXX)"
trap 'rm -f "$archive"; rm -rf "$stage"' EXIT
git -C "$source_dir" archive --format=tar --output="$archive" HEAD
tar -xf "$archive" -C "$stage"

if [[ "$source_dir" != "$APP_DIR" ]]; then
  install -d -m 750 "$APP_DIR"
  rsync -a --delete \
    --exclude='.env' \
    --exclude='data/' \
    --exclude='frontend/dist/' \
    "$stage/" "$APP_DIR/"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

if [[ ! -x "$APP_DIR/.venv/bin/python" ]]; then
  python3 -m venv "$APP_DIR/.venv"
fi
"$APP_DIR/.venv/bin/python" -m pip install --upgrade pip
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

if command -v npm >/dev/null; then
  (
    cd "$APP_DIR/frontend"
    npm ci
    npm run build
  )
elif [[ ! -f "$APP_DIR/frontend/dist/index.html" ]]; then
  die "npm is required because frontend/dist is absent"
fi

install -m 644 \
  "$APP_DIR/deploy/systemd/yanxin-review.service" \
  /etc/systemd/system/yanxin-review.service

install -m 644 \
  "$APP_DIR/deploy/systemd/yanxin-review-backup.service" \
  /etc/systemd/system/yanxin-review-backup.service
install -m 644 \
  "$APP_DIR/deploy/systemd/yanxin-review-backup.timer" \
  /etc/systemd/system/yanxin-review-backup.timer
install -m 644 \
  "$APP_DIR/deploy/systemd/yanxin-review-monitor.service" \
  /etc/systemd/system/yanxin-review-monitor.service
install -m 644 \
  "$APP_DIR/deploy/systemd/yanxin-review-monitor.timer" \
  /etc/systemd/system/yanxin-review-monitor.timer

if [[ -n "$SERVER_NAME" && -n "$CERT_NAME" ]]; then
  if [[ -f "/etc/letsencrypt/live/$CERT_NAME/fullchain.pem" ]]; then
    sed \
      -e "s/__SERVER_NAME__/$SERVER_NAME/g" \
      -e "s/__CERT_NAME__/$CERT_NAME/g" \
      "$APP_DIR/deploy/nginx/yanxin-review.conf.template" \
      > "/etc/nginx/sites-available/yanxin-review"
    ln -sfn \
      /etc/nginx/sites-available/yanxin-review \
      /etc/nginx/sites-enabled/yanxin-review
    nginx -t
    systemctl reload nginx
  else
    printf 'warning: certificate %s not found; Nginx site unchanged\n' "$CERT_NAME" >&2
  fi
fi

systemctl daemon-reload
systemctl enable --now yanxin-review.service
systemctl enable --now yanxin-review-backup.timer
systemctl enable --now yanxin-review-monitor.timer
systemctl restart yanxin-review.service

for _attempt in $(seq 1 45); do
  if curl -fsS --max-time 3 http://127.0.0.1:8010/api/health >/dev/null; then
    printf 'deployment ready\n'
    exit 0
  fi
  sleep 1
done

systemctl status yanxin-review.service --no-pager -l || true
die "application health check did not pass"
