# Deployment Operations

This directory contains the reproducible Linux deployment and operations files.
They target the synthetic-data demonstration environment. Never copy real
proposal DOC/DOCX files, personal data, or local browser artifacts to a public
server.

## Layout

- `install.sh`: install tracked source, Python dependencies, frontend build,
  systemd units, and optional Nginx site.
- `backup.sh`: create a PostgreSQL dump and upload/data archive.
- `restore.sh`: verify a backup by restoring it into an explicitly named test
  database and an empty temporary data directory.
- `monitor.sh`: check application health, service state, disk, memory, and
  certificate expiry.
- `smoke.sh`: remote login, route, API-leak, and optional model smoke test.
- `systemd/`: application, backup, and monitoring units and timers.
- `nginx/yanxin-review.conf.template`: HTTPS reverse-proxy template.

## Server prerequisites

Install Ubuntu packages:

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates curl nginx postgresql postgresql-contrib \
  python3 python3-venv python3-pip build-essential \
  poppler-utils libreoffice antiword tesseract-ocr tesseract-ocr-chi-sim \
  nodejs npm rsync
```

Create the application database and extension:

```bash
sudo -u postgres psql -c "CREATE ROLE yanxin LOGIN"
sudo -u postgres createdb -O yanxin yanxin_review
sudo -u postgres psql -d yanxin_review -c "CREATE EXTENSION IF NOT EXISTS vector"
```

Store runtime configuration outside the source checkout:

```bash
sudo install -d -m 700 /etc/yanxin-review
sudo sh -c 'umask 077; cp .env.example /etc/yanxin-review/app.env'
sudo editor /etc/yanxin-review/app.env
sudo chown root:root /etc/yanxin-review/app.env
sudo chmod 600 /etc/yanxin-review/app.env
```

Public demo values must remain synthetic-only. Keep `ALLOW_EXTERNAL_EMBED=0`,
use `EMBED_BACKEND=none` unless an approved internal embedding endpoint is
available, and set `COOKIE_SECURE=1`.

The optional model secret is kept in a separate root-only file:

```text
/etc/yanxin-review/model.env
```

Example keys:

```dotenv
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-flash
LLM_ENABLE_THINKING=0
LLM_THINKING_STYLE=deepseek
LLM_TIMEOUT=60
LLM_MAX_TOKENS=1200
ALLOW_EXTERNAL_LLM=1
DEEPSEEK_API_KEY=replace-me
```

Enabling a public model is an explicit data-egress decision. Use it only with
synthetic demo data or after the required approval for real materials.

## Install and update

The source update uses only files tracked by Git:

```bash
cd /opt/yanxin-review
sudo ./deploy/install.sh
```

Optional Nginx installation:

```bash
sudo SERVER_NAME=example.invalid CERT_NAME=example.invalid \
  ./deploy/install.sh
```

The script refuses to overwrite application data or secret files. It runs as
the dedicated `yanxin` service account and leaves port 8010 bound to loopback.

## Backups and restore drill

Install the provided timers once:

```bash
sudo ./deploy/install.sh
sudo systemctl list-timers 'yanxin-review-*'
sudo /opt/yanxin-review/deploy/backup.sh
```

Backups default to `/var/backups/yanxin-review` with 14-day retention. Each
snapshot contains a custom-format `pg_dump`, a compressed copy of the upload and
cache directory, a manifest, and SHA256 checksums.

A restore check must use an isolated database whose name ends in
`_restore_test`:

```bash
LATEST=/var/backups/yanxin-review/YYYYMMDDTHHMMSSZ
sudo /opt/yanxin-review/deploy/restore.sh \
  --db "$LATEST/db.dump" \
  --data "$LATEST/data.tar.gz" \
  --checksums "$LATEST/SHA256SUMS" \
  --target-db yanxin_review_restore_test \
  --target-dir /tmp/yanxin-review-restore-test
```

The script refuses an existing test database, a non-empty target directory,
or a target database without the safety suffix.

## Monitoring

```bash
sudo systemctl start yanxin-review-monitor.service
sudo journalctl -u yanxin-review-monitor.service -n 20 --no-pager
```

The timer runs every five minutes. Failures remain visible in journald and the
unit's non-zero exit status. Connect an approved internal alert channel before
production operation; this repository does not send notifications externally.

## Remote smoke test

Use a dedicated demo password through the environment, not a command-line
argument:

```bash
BASE_URL=https://demo.example.invalid \
DEMO_USER=manager \
DEMO_PASSWORD='use-a-secret-store-value' \
REQUIRE_MODEL=1 \
./deploy/smoke.sh
```

The smoke test verifies login, the main routes, health JSON redaction, and the
configured model catalogue. `RUN_MODEL_SMOKE=1` additionally makes one minimal
model request.

## Host hardening

- Use SSH keys for a dedicated non-root operator account.
- Keep password authentication and direct root SSH disabled once tested.
- Permit only SSH, HTTP, and HTTPS in the host firewall.
- Keep `/etc/yanxin-review` root-owned with `0700` directory and `0600` files.
- Keep the application bound to `127.0.0.1`; expose it only through Nginx TLS.
- Keep demo admin credentials separate from the public demo password.
- Rotate any credential that appears in logs, chat, tickets, or shell history.
