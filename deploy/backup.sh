#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-yanxin_review}"
DATA_DIR="${DATA_DIR:-/var/lib/yanxin-review/data}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/yanxin-review}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || die "run as root"
command -v pg_dump >/dev/null || die "pg_dump is not installed"
command -v tar >/dev/null || die "tar is not installed"
[[ -d "$DATA_DIR" ]] || die "data directory not found: $DATA_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 -o root -g root "$BACKUP_ROOT"
tmp_dir="$(mktemp -d "$BACKUP_ROOT/.tmp.${stamp}.XXXXXX")"
final_dir="$BACKUP_ROOT/$stamp"
trap 'rm -rf "$tmp_dir"' EXIT

runuser -u postgres -- pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$tmp_dir/db.dump" \
  "$DB_NAME"

tar \
  --numeric-owner \
  --one-file-system \
  -C "$(dirname "$DATA_DIR")" \
  -czf "$tmp_dir/data.tar.gz" \
  "$(basename "$DATA_DIR")"

cat > "$tmp_dir/manifest.txt" <<EOF
created_at=$stamp
database=$DB_NAME
data_dir=$DATA_DIR
host=$(hostname -f)
EOF

(
  cd "$tmp_dir"
  sha256sum db.dump data.tar.gz manifest.txt > SHA256SUMS
)

chmod 600 "$tmp_dir"/*
mv "$tmp_dir" "$final_dir"
trap - EXIT

find "$BACKUP_ROOT" \
  -mindepth 1 \
  -maxdepth 1 \
  -type d \
  -name '20??????T??????Z' \
  -mtime "+$RETENTION_DAYS" \
  -exec rm -rf -- {} +

printf '%s\n' "$final_dir"
