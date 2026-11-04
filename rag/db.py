from __future__ import annotations

import atexit
import json
import re
import sqlite3
import threading
import uuid
from datetime import datetime
from typing import Any, Iterable

from . import config
from .config import DB_PATH

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    year INTEGER,
    source TEXT NOT NULL DEFAULT 'upload',
    path TEXT NOT NULL,
    text_len INTEGER DEFAULT 0,
    page_count INTEGER DEFAULT 0,
    chunk_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ready',
    warning TEXT,
    meta_json TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    page INTEGER,
    section TEXT,
    text TEXT NOT NULL,
    char_len INTEGER DEFAULT 0,
    FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS papers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT,
    title TEXT NOT NULL,
    authors TEXT,
    year INTEGER,
    venue TEXT,
    abstract TEXT,
    keywords TEXT,
    is_sample INTEGER DEFAULT 0,
    source TEXT DEFAULT 'manual',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    institution TEXT,
    title TEXT,
    discipline TEXT,
    research_areas TEXT,
    achievements TEXT,
    avoid_institutions TEXT,
    avoid_people TEXT,
    workload INTEGER DEFAULT 0,
    available INTEGER DEFAULT 1,
    is_sample INTEGER DEFAULT 0,
    source TEXT DEFAULT 'manual',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dossiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    year INTEGER,
    plan_type TEXT NOT NULL DEFAULT 'directive',
    phase TEXT NOT NULL DEFAULT 'application',
    applicant_unit TEXT DEFAULT '',
    leader TEXT DEFAULT '',
    supervisor TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dossier_documents (
    dossier_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    role TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    is_current INTEGER NOT NULL DEFAULT 1,
    human_verified INTEGER NOT NULL DEFAULT 0,
    verified_by TEXT DEFAULT '',
    verified_at TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(dossier_id, doc_id),
    FOREIGN KEY(dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE,
    FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_cases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    dossier_id TEXT,
    doc_id TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'pre_review',
    status TEXT NOT NULL DEFAULT 'draft',
    round INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    final_decision TEXT,
    final_comment TEXT,
    FOREIGN KEY(dossier_id) REFERENCES dossiers(id) ON DELETE SET NULL,
    FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS review_tasks (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    assignee_username TEXT NOT NULL,
    expert_id INTEGER,
    expert_name TEXT NOT NULL,
    expert_institution TEXT NOT NULL DEFAULT '',
    expert_title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'assigned',
    conflict_declared INTEGER NOT NULL DEFAULT 0,
    conflict_reason TEXT NOT NULL DEFAULT '',
    recommendation TEXT,
    opinion TEXT,
    submitted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES review_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_case_rounds (
    case_id TEXT PRIMARY KEY REFERENCES review_cases(id) ON DELETE RESTRICT,
    root_case_id TEXT NOT NULL REFERENCES review_cases(id) ON DELETE RESTRICT,
    previous_case_id TEXT NOT NULL UNIQUE REFERENCES review_cases(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS review_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    task_id TEXT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES review_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_artifacts (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    title TEXT NOT NULL,
    round INTEGER NOT NULL,
    format TEXT NOT NULL DEFAULT 'markdown',
    content TEXT NOT NULL,
    payload_json TEXT,
    source_doc_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES review_cases(id) ON DELETE CASCADE,
    FOREIGN KEY(source_doc_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    display_name TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_accounts (
    username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE RESTRICT,
    expert_id INTEGER NOT NULL UNIQUE REFERENCES experts(id) ON DELETE RESTRICT,
    bound_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_account_history (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expert_id INTEGER NOT NULL,
    expert_name TEXT NOT NULL DEFAULT '',
    expert_institution TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_experts_discipline ON experts(discipline);
CREATE INDEX IF NOT EXISTS idx_dossier_documents_role
    ON dossier_documents(dossier_id, role, is_current);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dossier_documents_version
    ON dossier_documents(dossier_id, role, version);
CREATE INDEX IF NOT EXISTS idx_review_cases_updated
    ON review_cases(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_tasks_assignee
    ON review_tasks(assignee_username, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_tasks_case
    ON review_tasks(case_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_tasks_case_expert
    ON review_tasks(case_id, expert_id) WHERE expert_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_review_artifacts_case
    ON review_artifacts(case_id, created_at DESC);
"""

POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    year INTEGER,
    source TEXT NOT NULL DEFAULT 'upload',
    path TEXT NOT NULL,
    text_len INTEGER DEFAULT 0,
    page_count INTEGER DEFAULT 0,
    chunk_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ready',
    warning TEXT,
    meta_json TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    doc_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    page INTEGER,
    section TEXT,
    text TEXT NOT NULL,
    char_len INTEGER DEFAULT 0,
    FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS papers (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    doc_id TEXT,
    title TEXT NOT NULL,
    authors TEXT,
    year INTEGER,
    venue TEXT,
    abstract TEXT,
    keywords TEXT,
    is_sample INTEGER DEFAULT 0,
    source TEXT DEFAULT 'manual',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experts (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    institution TEXT,
    title TEXT,
    discipline TEXT,
    research_areas TEXT,
    achievements TEXT,
    avoid_institutions TEXT,
    avoid_people TEXT,
    workload INTEGER DEFAULT 0,
    available INTEGER DEFAULT 1,
    is_sample INTEGER DEFAULT 0,
    source TEXT DEFAULT 'manual',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dossiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    year INTEGER,
    plan_type TEXT NOT NULL DEFAULT 'directive',
    phase TEXT NOT NULL DEFAULT 'application',
    applicant_unit TEXT DEFAULT '',
    leader TEXT DEFAULT '',
    supervisor TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dossier_documents (
    dossier_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    role TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    is_current INTEGER NOT NULL DEFAULT 1,
    human_verified INTEGER NOT NULL DEFAULT 0,
    verified_by TEXT DEFAULT '',
    verified_at TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(dossier_id, doc_id),
    FOREIGN KEY(dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE,
    FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_cases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    dossier_id TEXT,
    doc_id TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'pre_review',
    status TEXT NOT NULL DEFAULT 'draft',
    round INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    final_decision TEXT,
    final_comment TEXT,
    FOREIGN KEY(dossier_id) REFERENCES dossiers(id) ON DELETE SET NULL,
    FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS review_tasks (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    assignee_username TEXT NOT NULL,
    expert_id INTEGER,
    expert_name TEXT NOT NULL,
    expert_institution TEXT NOT NULL DEFAULT '',
    expert_title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'assigned',
    conflict_declared INTEGER NOT NULL DEFAULT 0,
    conflict_reason TEXT NOT NULL DEFAULT '',
    recommendation TEXT,
    opinion TEXT,
    submitted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES review_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_case_rounds (
    case_id TEXT PRIMARY KEY REFERENCES review_cases(id) ON DELETE RESTRICT,
    root_case_id TEXT NOT NULL REFERENCES review_cases(id) ON DELETE RESTRICT,
    previous_case_id TEXT NOT NULL UNIQUE REFERENCES review_cases(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS review_actions (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    case_id TEXT NOT NULL,
    task_id TEXT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES review_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_artifacts (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    title TEXT NOT NULL,
    round INTEGER NOT NULL,
    format TEXT NOT NULL DEFAULT 'markdown',
    content TEXT NOT NULL,
    payload_json TEXT,
    source_doc_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES review_cases(id) ON DELETE CASCADE,
    FOREIGN KEY(source_doc_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    display_name TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_accounts (
    username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE RESTRICT,
    expert_id INTEGER NOT NULL UNIQUE REFERENCES experts(id) ON DELETE RESTRICT,
    bound_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_account_history (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expert_id INTEGER NOT NULL,
    expert_name TEXT NOT NULL DEFAULT '',
    expert_institution TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_experts_discipline ON experts(discipline);
CREATE INDEX IF NOT EXISTS idx_dossier_documents_role
    ON dossier_documents(dossier_id, role, is_current);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dossier_documents_version
    ON dossier_documents(dossier_id, role, version);
CREATE INDEX IF NOT EXISTS idx_review_cases_updated
    ON review_cases(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_tasks_assignee
    ON review_tasks(assignee_username, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_tasks_case
    ON review_tasks(case_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_tasks_case_expert
    ON review_tasks(case_id, expert_id) WHERE expert_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_review_artifacts_case
    ON review_artifacts(case_id, created_at DESC);
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class CompatRow(dict):
    """同时支持 sqlite3.Row 的键访问和序号访问。"""

    def __init__(self, columns: Iterable[str], values: tuple[Any, ...]) -> None:
        super().__init__(zip(columns, values))
        self._values = tuple(values)

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)


def _pg_row_factory(cursor):
    columns = [column.name for column in cursor.description or ()]

    def make_row(values):
        return CompatRow(columns, values)

    return make_row


def _postgres_sql(sql: str) -> str:
    """把现有 SQLite 参数占位符转换为 psycopg 占位符。"""
    return sql.replace("?", "%s")


class PostgresConnection:
    """轻量兼容层，让现有 SQL 调用同时支持 psycopg。"""

    def __init__(self, connection, pool=None) -> None:
        self._connection = connection
        self._pool = pool

    def execute(self, sql: str, params=()):
        query = _postgres_sql(sql)
        if params:
            return self._connection.execute(query, tuple(params))
        return self._connection.execute(query)

    def executemany(self, sql: str, params_seq):
        with self._connection.cursor() as cursor:
            cursor.executemany(_postgres_sql(sql), params_seq)
            return cursor.rowcount

    def executescript(self, script: str) -> None:
        with self._connection.cursor() as cursor:
            cursor.execute(script)

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        self._connection.rollback()

    def close(self) -> None:
        if self._pool is not None:
            self._pool.putconn(self._connection)
        else:
            self._connection.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, _exc, _tb) -> None:
        try:
            if exc_type is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()

    def __getattr__(self, name: str):
        return getattr(self._connection, name)


def backend() -> str:
    return config.DATABASE_BACKEND


_pool = None
_pool_lock = threading.Lock()


def _postgres_pool():
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is not None:
            return _pool
        try:
            from psycopg_pool import ConnectionPool
        except ImportError as exc:
            raise RuntimeError(
                "PostgreSQL 连接池需要安装 psycopg-pool："
                "python3 -m pip install 'psycopg-pool>=3.2,<4'"
            ) from exc
        pool = ConnectionPool(
            conninfo=config.DATABASE_URL,
            min_size=config.DATABASE_POOL_MIN,
            max_size=config.DATABASE_POOL_MAX,
            timeout=10,
            kwargs={
                "row_factory": _pg_row_factory,
                "connect_timeout": 10,
            },
            open=False,
        )
        pool.open(wait=True, timeout=10)
        _pool = pool
        return pool


def close_db() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None


def connect():
    if backend() == "postgresql":
        pool = _postgres_pool()
        return PostgresConnection(pool.getconn(timeout=10), pool)

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _init_pgvector() -> None:
    if config.VECTOR_STORE_BACKEND != "pgvector":
        return
    table = config.PGVECTOR_TABLE
    with connect() as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {table} (
                namespace TEXT NOT NULL,
                chunk_id TEXT NOT NULL,
                doc_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                section TEXT,
                model TEXT NOT NULL,
                embedding vector({config.PGVECTOR_DIM}) NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(namespace, chunk_id)
            )
            """
        )
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS {table}_doc_idx ON {table}(namespace, doc_id)"
        )
        conn.execute(
            f"""
            CREATE INDEX IF NOT EXISTS {table}_embedding_hnsw
            ON {table} USING hnsw (embedding vector_cosine_ops)
            """
        )


def init_db() -> None:
    with connect() as conn:
        conn.executescript(POSTGRES_SCHEMA if backend() == "postgresql" else SQLITE_SCHEMA)
        if backend() == "postgresql":
            for column in ("expert_name", "expert_institution"):
                conn.execute(f"ALTER TABLE expert_account_history ADD COLUMN IF NOT EXISTS {column} TEXT NOT NULL DEFAULT ''")
        else:
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(expert_account_history)").fetchall()}
            for column in ("expert_name", "expert_institution"):
                if column not in columns:
                    conn.execute(f"ALTER TABLE expert_account_history ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
    _init_pgvector()


def _row(row: Any | None) -> dict[str, Any] | None:
    if row is None:
        return None
    data = dict(row)
    if "meta_json" in data and data["meta_json"]:
        try:
            data["meta"] = json.loads(data["meta_json"])
        except json.JSONDecodeError:
            data["meta"] = {}
    data.pop("meta_json", None)
    return data


def insert_document(doc: dict[str, Any], chunks: list[dict[str, Any]]) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO documents
            (id, name, kind, year, source, path, text_len, page_count, chunk_count,
             status, warning, meta_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                doc["id"],
                doc["name"],
                doc.get("kind", "other"),
                doc.get("year"),
                doc.get("source", "upload"),
                doc["path"],
                doc.get("text_len", 0),
                doc.get("page_count", 0),
                len(chunks),
                doc.get("status", "ready"),
                doc.get("warning"),
                json.dumps(doc.get("meta", {}), ensure_ascii=False),
                doc.get("created_at", now()),
            ),
        )
        conn.executemany(
            """
            INSERT INTO chunks (doc_id, idx, page, section, text, char_len)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    doc["id"],
                    c["idx"],
                    c.get("page"),
                    c.get("section") or "",
                    c["text"],
                    len(c["text"]),
                )
                for c in chunks
            ],
        )


def list_documents() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, name, kind, year, source, text_len, page_count, chunk_count,
                   status, warning, created_at
            FROM documents ORDER BY created_at DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def get_document(doc_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    return _row(row)


def delete_document(doc_id: str) -> dict[str, Any] | None:
    doc = get_document(doc_id)
    if not doc:
        return None
    with connect() as conn:
        case = conn.execute(
            "SELECT id FROM review_cases WHERE doc_id = ? LIMIT 1",
            (doc_id,),
        ).fetchone()
        if case:
            raise ValueError("文档已进入评审案卷，不能直接删除")
        conn.execute("DELETE FROM dossier_documents WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM papers WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    return doc


def list_dossiers() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM dossiers
            ORDER BY updated_at DESC, created_at DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def get_dossier(dossier_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM dossiers WHERE id = ?", (dossier_id,)
        ).fetchone()
    return dict(row) if row else None


def insert_dossier(dossier: dict[str, Any]) -> dict[str, Any]:
    stamp = now()
    record = {
        "id": dossier.get("id") or new_id(),
        "name": dossier["name"],
        "year": dossier.get("year"),
        "plan_type": dossier.get("plan_type", "directive"),
        "phase": dossier.get("phase", "application"),
        "applicant_unit": dossier.get("applicant_unit", ""),
        "leader": dossier.get("leader", ""),
        "supervisor": dossier.get("supervisor", ""),
        "created_at": stamp,
        "updated_at": stamp,
    }
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO dossiers
            (id, name, year, plan_type, phase, applicant_unit, leader, supervisor,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["id"],
                record["name"],
                record["year"],
                record["plan_type"],
                record["phase"],
                record["applicant_unit"],
                record["leader"],
                record["supervisor"],
                record["created_at"],
                record["updated_at"],
            ),
        )
    return record


def update_dossier(dossier_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {
        "name",
        "year",
        "plan_type",
        "phase",
        "applicant_unit",
        "leader",
        "supervisor",
    }
    values = {key: value for key, value in changes.items() if key in allowed}
    if not values:
        return get_dossier(dossier_id)
    values["updated_at"] = now()
    assignments = ", ".join(f"{key} = ?" for key in values)
    with connect() as conn:
        conn.execute(
            f"UPDATE dossiers SET {assignments} WHERE id = ?",
            (*values.values(), dossier_id),
        )
    return get_dossier(dossier_id)


def delete_dossier(dossier_id: str) -> dict[str, Any] | None:
    dossier = get_dossier(dossier_id)
    if not dossier:
        return None
    with connect() as conn:
        linked = conn.execute(
            "SELECT id FROM review_cases WHERE dossier_id = ? LIMIT 1",
            (dossier_id,),
        ).fetchone()
        if linked:
            raise ValueError("历史课题已关联评审案卷，不能删除")
        conn.execute("DELETE FROM dossiers WHERE id = ?", (dossier_id,))
    return dossier


def list_dossier_documents(dossier_id: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT dd.dossier_id, dd.doc_id, dd.role, dd.version, dd.is_current,
                   dd.human_verified, dd.verified_by, dd.verified_at, dd.created_at,
                   d.name AS doc_name, d.kind AS doc_kind, d.status AS doc_status,
                   d.warning AS doc_warning, d.path AS doc_path
            FROM dossier_documents dd
            JOIN documents d ON d.id = dd.doc_id
            WHERE dd.dossier_id = ?
            ORDER BY dd.role, dd.is_current DESC, dd.version DESC, dd.created_at DESC
            """,
            (dossier_id,),
        ).fetchall()
    records = []
    for row in rows:
        record = dict(row)
        record["human_verified"] = bool(record["human_verified"])
        record["is_current"] = bool(record["is_current"])
        record["doc_suffix"] = _path_suffix(record.pop("doc_path", ""))
        records.append(record)
    return records


def _path_suffix(path: str) -> str:
    """Return a lower-case suffix without exposing the stored path to callers."""
    clean = str(path or "").strip().lower()
    dot = clean.rfind(".")
    return clean[dot:] if dot >= 0 else ""


def attach_dossier_document(
    dossier_id: str,
    doc_id: str,
    role: str,
) -> dict[str, Any]:
    stamp = now()
    with connect() as conn:
        dossier = conn.execute(
            "SELECT id FROM dossiers WHERE id = ?", (dossier_id,)
        ).fetchone()
        document = conn.execute(
            "SELECT id, kind FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        if not dossier:
            raise KeyError("dossier")
        if not document:
            raise KeyError("document")
        # Lazy import avoids the db <-> dossiers module cycle while keeping the
        # database write path safe even if a future caller bypasses the API.
        from .dossiers import validate_attachment

        validate_attachment(role, document["kind"])
        existing = conn.execute(
            """
            SELECT role FROM dossier_documents
            WHERE dossier_id = ? AND doc_id = ?
            """,
            (dossier_id, doc_id),
        ).fetchone()
        if existing:
            raise ValueError("该资料已在卷宗中，请先移除后重新归入")
        version = conn.execute(
            """
            SELECT COALESCE(MAX(version), 0) + 1
            FROM dossier_documents
            WHERE dossier_id = ? AND role = ?
            """,
            (dossier_id, role),
        ).fetchone()[0]
        conn.execute(
            """
            UPDATE dossier_documents
            SET is_current = 0
            WHERE dossier_id = ? AND role = ?
            """,
            (dossier_id, role),
        )
        conn.execute(
            """
            INSERT INTO dossier_documents
            (dossier_id, doc_id, role, version, is_current, human_verified,
             verified_by, verified_at, created_at)
            VALUES (?, ?, ?, ?, 1, 0, '', NULL, ?)
            """,
            (dossier_id, doc_id, role, version, stamp),
        )
        conn.execute(
            "UPDATE dossiers SET updated_at = ? WHERE id = ?",
            (stamp, dossier_id),
        )
    row = next(
        item
        for item in list_dossier_documents(dossier_id)
        if item["doc_id"] == doc_id
    )
    return row


def update_dossier_document(
    dossier_id: str,
    doc_id: str,
    *,
    human_verified: bool | None = None,
    is_current: bool | None = None,
    verified_by: str = "",
) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM dossier_documents
            WHERE dossier_id = ? AND doc_id = ?
            """,
            (dossier_id, doc_id),
        ).fetchone()
        if not row:
            return None
        stamp = now()
        if is_current is True:
            conn.execute(
                """
                UPDATE dossier_documents
                SET is_current = 0
                WHERE dossier_id = ? AND role = ? AND doc_id <> ?
                """,
                (dossier_id, row["role"], doc_id),
            )
        if human_verified is not None:
            conn.execute(
                """
                UPDATE dossier_documents
                SET human_verified = ?, verified_by = ?, verified_at = ?
                WHERE dossier_id = ? AND doc_id = ?
                """,
                (
                    1 if human_verified else 0,
                    verified_by if human_verified else "",
                    stamp if human_verified else None,
                    dossier_id,
                    doc_id,
                ),
            )
        if is_current is not None:
            conn.execute(
                """
                UPDATE dossier_documents SET is_current = ?
                WHERE dossier_id = ? AND doc_id = ?
                """,
                (1 if is_current else 0, dossier_id, doc_id),
            )
        conn.execute(
            "UPDATE dossiers SET updated_at = ? WHERE id = ?",
            (stamp, dossier_id),
        )
    return next(
        (
            item
            for item in list_dossier_documents(dossier_id)
            if item["doc_id"] == doc_id
        ),
        None,
    )


def detach_dossier_document(dossier_id: str, doc_id: str) -> bool:
    with connect() as conn:
        removed = conn.execute(
            """
            SELECT role, version, is_current FROM dossier_documents
            WHERE dossier_id = ? AND doc_id = ?
            """,
            (dossier_id, doc_id),
        ).fetchone()
        if not removed:
            return False
        cur = conn.execute(
            """
            DELETE FROM dossier_documents
            WHERE dossier_id = ? AND doc_id = ?
            """,
            (dossier_id, doc_id),
        )
        if cur.rowcount:
            if removed["is_current"]:
                conn.execute(
                    """
                    UPDATE dossier_documents
                    SET is_current = 1
                    WHERE dossier_id = ? AND doc_id = (
                        SELECT doc_id FROM dossier_documents
                        WHERE dossier_id = ? AND role = ?
                        ORDER BY version DESC
                        LIMIT 1
                    )
                    """,
                    (dossier_id, dossier_id, removed["role"]),
                )
            conn.execute(
                "UPDATE dossiers SET updated_at = ? WHERE id = ?",
                (now(), dossier_id),
            )
    return bool(cur.rowcount)


def get_chunks(doc_id: str | None = None) -> list[dict[str, Any]]:
    with connect() as conn:
        if doc_id:
            rows = conn.execute(
                "SELECT * FROM chunks WHERE doc_id = ? ORDER BY idx", (doc_id,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM chunks ORDER BY doc_id, idx").fetchall()
    return [dict(r) for r in rows]


def insert_paper(paper: dict[str, Any]) -> int:
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO papers
            (doc_id, title, authors, year, venue, abstract, keywords, is_sample, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                paper.get("doc_id"),
                paper["title"],
                paper.get("authors", ""),
                paper.get("year"),
                paper.get("venue", ""),
                paper.get("abstract", ""),
                paper.get("keywords", ""),
                1 if paper.get("is_sample") else 0,
                paper.get("source", "manual"),
                paper.get("created_at", now()),
            ),
        )
        return int(cur.fetchone()["id"])


def list_papers(limit: int | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM papers ORDER BY year DESC, id DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    with connect() as conn:
        rows = conn.execute(sql).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        raw = (item.get("keywords") or "").replace("；", ";").replace("，", ";").replace("、", ";").replace(",", ";")
        item["keywords_list"] = [k.strip() for k in raw.split(";") if k.strip()]
        out.append(item)
    return out


def count_papers() -> int:
    with connect() as conn:
        return int(conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0])


def delete_sample_documents() -> int:
    """删除全部演示本子（source='demo' 的文档及其分块）。"""
    with connect() as conn:
        ids = [r["id"] for r in conn.execute(
            "SELECT id FROM documents WHERE source = 'demo'").fetchall()]
        if not ids:
            return 0
        marks = ",".join("?" for _ in ids)
        conn.execute(f"DELETE FROM chunks WHERE doc_id IN ({marks})", ids)
        cur = conn.execute(f"DELETE FROM documents WHERE id IN ({marks})", ids)
        return int(cur.rowcount)


def delete_sample_papers() -> int:
    with connect() as conn:
        cur = conn.execute("DELETE FROM papers WHERE is_sample = 1")
        return int(cur.rowcount)


def public_policy_docs() -> dict[str, str]:
    """公开政策语料的 source_id → 文档 id 映射，供幂等导入判断是否已入库。"""
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, meta_json FROM documents WHERE source = 'public'"
        ).fetchall()
    out: dict[str, str] = {}
    for row in rows:
        try:
            meta = json.loads(row["meta_json"] or "{}")
        except json.JSONDecodeError:
            continue
        source_id = str(meta.get("source_id") or "").strip()
        if source_id:
            out[source_id] = row["id"]
    return out


def insert_expert(expert: dict[str, Any]) -> int:
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO experts
            (name, institution, title, discipline, research_areas, achievements,
             avoid_institutions, avoid_people, workload, available, is_sample, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                expert["name"],
                expert.get("institution", ""),
                expert.get("title", ""),
                expert.get("discipline", ""),
                expert.get("research_areas", ""),
                expert.get("achievements", ""),
                expert.get("avoid_institutions", ""),
                expert.get("avoid_people", ""),
                int(expert.get("workload") or 0),
                1 if expert.get("available", True) else 0,
                1 if expert.get("is_sample") else 0,
                expert.get("source", "manual"),
                expert.get("created_at", now()),
            ),
        )
        return int(cur.fetchone()["id"])


def list_experts(limit: int | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM experts ORDER BY is_sample DESC, id ASC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    with connect() as conn:
        rows = conn.execute(sql).fetchall()
    return [dict(r) for r in rows]


def count_experts() -> int:
    with connect() as conn:
        return int(conn.execute("SELECT COUNT(*) FROM experts").fetchone()[0])


def delete_sample_experts() -> int:
    with connect() as conn:
        if conn.execute("SELECT 1 FROM experts e JOIN expert_accounts a ON a.expert_id = e.id WHERE e.is_sample = 1 LIMIT 1").fetchone():
            raise ValueError("演示专家已绑定账号，不能直接移除")
        cur = conn.execute("DELETE FROM experts WHERE is_sample = 1")
        return int(cur.rowcount)


def stats() -> dict[str, int]:
    with connect() as conn:
        docs = int(conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0])
        chunks = int(conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0])
        papers = int(conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0])
        samples = int(conn.execute("SELECT COUNT(*) FROM papers WHERE is_sample = 1").fetchone()[0])
        experts = int(conn.execute("SELECT COUNT(*) FROM experts").fetchone()[0])
        sample_experts = int(conn.execute("SELECT COUNT(*) FROM experts WHERE is_sample = 1").fetchone()[0])
    return {
        "documents": docs,
        "chunks": chunks,
        "papers": papers,
        "sample_papers": samples,
        "experts": experts,
        "sample_experts": sample_experts,
    }


def get_meta(key: str) -> str | None:
    with connect() as conn:
        row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(key: str, value: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def _norm_key(*parts: Any) -> str:
    return "|".join(re.sub(r"\s+", "", str(p or "")).casefold() for p in parts)


def paper_keys() -> set[str]:
    """库内全部文献的去重键（批量导入前预载，避免逐行全表扫描）。"""
    with connect() as conn:
        rows = conn.execute("SELECT title, year FROM papers").fetchall()
    return {_norm_key(r["title"], r["year"]) for r in rows}


def expert_keys() -> set[str]:
    with connect() as conn:
        rows = conn.execute("SELECT name, institution FROM experts").fetchall()
    return {_norm_key(r["name"], r["institution"]) for r in rows}


def insert_paper_if_new(paper: dict[str, Any], known_keys: set[str] | None = None) -> bool:
    """同一文献（标题+年份）重复导入时跳过；批量导入时传入预载键集。"""
    key = _norm_key(paper.get("title"), paper.get("year"))
    if known_keys is None:
        known_keys = paper_keys()
    if key in known_keys:
        return False
    insert_paper(paper)
    known_keys.add(key)
    return True


def insert_expert_if_new(expert: dict[str, Any], known_keys: set[str] | None = None) -> bool:
    """同一专家（姓名+单位）重复导入时跳过；批量导入时传入预载键集。"""
    key = _norm_key(expert.get("name"), expert.get("institution"))
    if known_keys is None:
        known_keys = expert_keys()
    if key in known_keys:
        return False
    insert_expert(expert)
    known_keys.add(key)
    return True


atexit.register(close_db)
