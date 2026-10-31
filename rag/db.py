from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime
from typing import Any

from .config import DB_PATH

SCHEMA = """
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
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
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
        return int(cur.lastrowid)


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
        return int(cur.lastrowid)


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
