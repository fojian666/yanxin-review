"""把现有 SQLite 数据复制到 PostgreSQL。

示例：
    python3 -m tools.migrate_sqlite_to_postgres \
      --database-url postgresql:///yanxin_review

默认幂等：目标表已有相同主键时跳过。只有显式传入 --clear 才清空目标业务表。
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent

TABLES = [
    "users",
    "documents",
    "chunks",
    "papers",
    "experts",
    "dossiers",
    "dossier_documents",
    "review_cases",
    "review_tasks",
    "review_actions",
    "review_artifacts",
    "meta",
    "sessions",
]
IDENTITY_TABLES = ("chunks", "papers", "experts", "review_actions")


def _columns(source: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in source.execute(f"PRAGMA table_info({table})").fetchall()]


def migrate(
    sqlite_path: Path,
    database_url: str,
    *,
    clear: bool = False,
) -> dict[str, int]:
    if not sqlite_path.is_file():
        raise ValueError(f"SQLite 源库不存在：{sqlite_path}")
    target_name = urlparse(database_url).path.lstrip("/") or "postgres"
    if clear and not target_name.endswith("_test"):
        raise ValueError("拒绝清空非 *_test 数据库；--clear 仅允许测试库")
    os.environ["DATABASE_BACKEND"] = "postgresql"
    os.environ["DATABASE_URL"] = database_url
    from rag import config, db

    config.DATABASE_BACKEND = "postgresql"
    config.DATABASE_URL = database_url
    db.init_db()
    source = sqlite3.connect(sqlite_path)
    source.row_factory = sqlite3.Row
    copied: dict[str, int] = {}
    try:
        with db.connect() as target:
            if clear:
                for table in reversed(TABLES):
                    target.execute(f"DELETE FROM {table}")
            for table in TABLES:
                columns = _columns(source, table)
                if not columns:
                    copied[table] = 0
                    continue
                rows = source.execute(f"SELECT * FROM {table}").fetchall()
                inserted = 0
                if rows:
                    marks = ", ".join("?" for _ in columns)
                    inserted = int(target.executemany(
                        f"""
                        INSERT INTO {table} ({", ".join(columns)})
                        VALUES ({marks})
                        ON CONFLICT DO NOTHING
                        """,
                        [tuple(row[column] for column in columns) for row in rows],
                    ) or 0)
                copied[table] = inserted
            for table in IDENTITY_TABLES:
                target.execute(
                    f"""
                    SELECT setval(
                        pg_get_serial_sequence('{table}', 'id'),
                        GREATEST(COALESCE(MAX(id), 0) + 1, 1),
                        false
                    )
                    FROM {table}
                    """
                )
    finally:
        source.close()
    return copied


def main() -> int:
    parser = argparse.ArgumentParser(description="迁移 SQLite 数据到 PostgreSQL")
    parser.add_argument(
        "--sqlite",
        type=Path,
        default=ROOT / "data" / "app.db",
    )
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL", "postgresql:///yanxin_review"),
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="先清空目标业务表；首次迁移通常不需要",
    )
    args = parser.parse_args()
    result = migrate(args.sqlite.resolve(), args.database_url, clear=args.clear)
    print(json.dumps({"ok": True, "tables": result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
