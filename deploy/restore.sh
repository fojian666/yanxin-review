#!/usr/bin/env bash
set -euo pipefail

db_dump=""
data_archive=""
checksums=""
target_db=""
target_dir=""

usage() {
  cat <<'EOF'
usage: restore.sh --db FILE --data FILE --target-db NAME --target-dir DIR [--checksums FILE]

The target database name must end in _restore_test. The target directory must
be absent or empty. This script never restores into the production data path.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) db_dump="${2:-}"; shift 2 ;;
    --data) data_archive="${2:-}"; shift 2 ;;
    --checksums) checksums="${2:-}"; shift 2 ;;
    --target-db) target_db="${2:-}"; shift 2 ;;
    --target-dir) target_dir="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

[[ ${EUID} -eq 0 ]] || die "run as root"
[[ -f "$db_dump" ]] || die "--db file not found"
[[ -f "$data_archive" ]] || die "--data file not found"
[[ "$target_db" =~ ^[a-zA-Z0-9_]+_restore_test$ ]] || \
  die "target database must end in _restore_test"
[[ -n "$target_dir" ]] || die "--target-dir is required"
[[ "$target_dir" != /var/lib/yanxin-review/data ]] || die "refusing production data path"
[[ ! -e "$target_dir" || -z "$(find "$target_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]] || \
  die "target directory must be absent or empty"

if [[ -n "$checksums" ]]; then
  [[ -f "$checksums" ]] || die "--checksums file not found"
  (
    cd "$(dirname "$checksums")"
    sha256sum --check "$(basename "$checksums")"
  )
fi

if runuser -u postgres -- psql -Atqc \
  "SELECT 1 FROM pg_database WHERE datname='$target_db'" postgres | grep -qx 1; then
  die "target database already exists: $target_db"
fi

runuser -u postgres -- createdb "$target_db"
restore_ok=false
cleanup() {
  if [[ "$restore_ok" != true ]]; then
    runuser -u postgres -- dropdb --if-exists "$target_db" >/dev/null 2>&1 || true
    rm -rf -- "$target_dir"
  fi
}
trap cleanup EXIT

runuser -u postgres -- pg_restore \
  --exit-on-error \
  --no-owner \
  --no-acl \
  -d "$target_db" \
  "$db_dump"

install -d -m 700 "$target_dir"
tar -xzf "$data_archive" -C "$target_dir"
restore_ok=true

row_counts="$(runuser -u postgres -- psql -Atqc \
  "SELECT 'documents=' || count(*) FROM documents UNION ALL SELECT 'users=' || count(*) FROM users UNION ALL SELECT 'chunks=' || count(*) FROM chunks" \
  "$target_db")"
printf 'restore_ok=true\ntarget_db=%s\ntarget_dir=%s\n%s\n' \
  "$target_db" "$target_dir" "$row_counts"
