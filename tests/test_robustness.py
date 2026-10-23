import asyncio

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import app as app_module
from rag import config, db, parsers, trends


def test_trends_empty_library_returns_empty_result(monkeypatch):
    """A library with no papers must return an empty trend, not crash in TF-IDF."""
    monkeypatch.setattr(trends.db, "list_papers", lambda: [])
    result = trends.analyze_trends("科研诚信", 2019, 2025)
    assert result["stats"]["total"] == 0
    assert result["counts"] == [0] * 7
    assert result["papers"] == []


def test_spa_rejects_path_traversal():
    """The SPA fallback must never serve files outside frontend/dist."""
    with pytest.raises(HTTPException) as exc:
        asyncio.run(app_module.spa("../requirements.txt"))
    assert exc.value.status_code == 404


def test_unhandled_error_does_not_leak_internal_details():
    """Unexpected errors should return a generic message to the client."""
    response = asyncio.run(
        app_module.unhandled_error_handler(None, RuntimeError("secret-db-password"))
    )
    assert response.status_code == 500
    assert b"secret-db-password" not in response.body


def test_tool_check_request_rejects_invalid_top_k():
    """top_k must be bounded even if the caller sends an invalid value."""
    with pytest.raises(ValidationError):
        app_module.ToolCheckRequest(doc_id="doc-1", top_k=0)
    with pytest.raises(ValidationError):
        app_module.ToolCheckRequest(doc_id="doc-1", top_k=999)


def test_sqlite_connection_enables_wal(tmp_path, monkeypatch):
    """SQLite should use WAL + busy timeout for concurrent reads/writes."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "robustness.db")
    db.init_db()
    conn = db.connect()
    try:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        busy = conn.execute("PRAGMA busy_timeout").fetchone()[0]
    finally:
        conn.close()
    assert str(mode).lower() == "wal"
    assert int(busy) >= 5000


def test_apply_content_limit_truncates_and_warns():
    """Oversized parsed text must be capped so chunking/index cannot blow up."""
    parsed = {
        "pages": [{"page": 1, "text": "科" * 500}, {"page": 2, "text": "研" * 500}],
        "page_count": 2,
        "warning": "",
        "text_len": 1000,
    }
    result = parsers.apply_content_limit(parsed, max_chars=600)
    assert result["text_len"] == 600
    assert sum(len(p["text"]) for p in result["pages"]) == 600
    assert "过长" in result["warning"]


def test_apply_content_limit_keeps_short_documents_untouched():
    """Documents within the limit must not be altered or warned about."""
    parsed = {
        "pages": [{"page": 1, "text": "科研诚信"}],
        "page_count": 1,
        "warning": "",
        "text_len": 4,
    }
    result = parsers.apply_content_limit(parsed, max_chars=600)
    assert result["text_len"] == 4
    assert result["warning"] == ""


def test_parse_upload_enforces_max_content_chars(tmp_path):
    """parse_upload must enforce config.MAX_CONTENT_CHARS end to end."""
    big = tmp_path / "big.txt"
    big.write_text("科" * (config.MAX_CONTENT_CHARS + 5000), encoding="utf-8")
    result = parsers.parse_upload(big)
    assert result["text_len"] <= config.MAX_CONTENT_CHARS
    assert "过长" in result["warning"]
