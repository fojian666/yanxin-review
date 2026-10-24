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
        conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM papers WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    return doc


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


def delete_sample_papers() -> int:
    with connect() as conn:
        cur = conn.execute("DELETE FROM papers WHERE is_sample = 1")
        return int(cur.rowcount)


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


def insert_paper_if_new(paper: dict[str, Any]) -> bool:
    """同一文献（标题+年份）重复导入时跳过，保证 CSV 重复导入幂等。"""
    key = _norm_key(paper.get("title"), paper.get("year"))
    with connect() as conn:
        rows = conn.execute("SELECT title, year FROM papers").fetchall()
    for row in rows:
        if _norm_key(row["title"], row["year"]) == key:
            return False
    insert_paper(paper)
    return True


def insert_expert_if_new(expert: dict[str, Any]) -> bool:
    """同一专家（姓名+单位）重复导入时跳过。"""
    key = _norm_key(expert.get("name"), expert.get("institution"))
    with connect() as conn:
        rows = conn.execute("SELECT name, institution FROM experts").fetchall()
    for row in rows:
        if _norm_key(row["name"], row["institution"]) == key:
            return False
    insert_expert(expert)
    return True
