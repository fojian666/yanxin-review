import asyncio
import io
import zipfile

import pytest
from fastapi import HTTPException, UploadFile
from pydantic import ValidationError

import app as app_module
from rag import config, db, ingest, parsers, schemas, seed, trends


def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "robustness.db")
    db.init_db()


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


def test_docx_footnotes_are_parsed(tmp_path):
    """Footnotes/endnotes carry citations and must not be dropped by parse_docx."""
    docx = tmp_path / "doc.docx"
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    body = f"<w:document {ns}><w:body><w:p><w:r><w:t>正文段落</w:t></w:r></w:p></w:body></w:document>"
    notes = (
        f"<w:footnotes {ns}><w:footnote><w:p><w:r><w:t>[1] 张三. 某参考文献. 2024.</w:t>"
        "</w:r></w:p></w:footnote></w:footnotes>"
    )
    with zipfile.ZipFile(docx, "w") as z:
        z.writestr("word/document.xml", body)
        z.writestr("word/footnotes.xml", notes)
    parsed = parsers.parse_docx(docx)
    text = parsed["pages"][0]["text"]
    assert "正文段落" in text
    assert "某参考文献" in text


def test_paper_and_expert_import_dedup(tmp_path, monkeypatch):
    """Re-importing the same CSV rows must be idempotent."""
    _tmp_db(tmp_path, monkeypatch)
    paper = {"title": "面向自然资源的科研诚信研究", "year": 2024, "source": "csv"}
    assert db.insert_paper_if_new(paper) is True
    assert db.insert_paper_if_new({**paper}) is False
    assert db.count_papers() == 1
    expert = {"name": "张三", "institution": "某大学", "source": "csv"}
    assert db.insert_expert_if_new(expert) is True
    assert db.insert_expert_if_new(expert) is False
    assert db.count_experts() == 1


def test_retriever_rebuild_drops_orphan_chunks(tmp_path, monkeypatch):
    """Chunks whose document row is gone must not enter the index."""
    _tmp_db(tmp_path, monkeypatch)
    from rag.retrieval import retriever

    db.insert_document(
        {"id": "d1", "name": "文档", "kind": "other", "path": "x", "source": "upload"},
        [{"idx": 0, "page": None, "section": "", "text": "科研诚信治理的内容段落"}],
    )
    retriever.rebuild()
    assert retriever.ready and len(retriever.chunks) == 1
    with db.connect() as conn:
        conn.execute("DELETE FROM documents WHERE id = 'd1'")
    retriever.rebuild()
    assert not retriever.ready


def test_seed_markers_live_in_db_and_migrate_legacy_files(tmp_path, monkeypatch):
    """Seed markers must share the DB lifecycle; legacy marker files are honored once."""
    _tmp_db(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "SEED_DEMO_PAPERS", True)
    (tmp_path / ".seeded_papers").write_text("seeded\n", encoding="utf-8")
    assert seed.seed_demo_papers() == 0
    assert db.get_meta("seeded_papers")
    assert db.count_papers() == 0


def test_seed_papers_on_fresh_db_is_idempotent(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "SEED_DEMO_PAPERS", True)
    assert seed.seed_demo_papers() == 42
    assert seed.seed_demo_papers() == 0
    assert db.count_papers() == 42


def test_upload_removes_file_when_chunking_fails(tmp_path, monkeypatch):
    """A failed chunking step must not leave an orphan file in uploads."""
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path)

    def boom(*args, **kwargs):
        raise RuntimeError("chunk failure")

    monkeypatch.setattr(app_module, "chunk_document", boom)
    upload = UploadFile(file=io.BytesIO("科研诚信测试内容。".encode("utf-8")), filename="test.txt")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(app_module.upload_document(file=upload, kind="auto", year="", title="", _user={"role": "admin", "username": "t"}))
    assert exc.value.status_code == 400
    assert list(tmp_path.iterdir()) == []


def test_upload_ignores_out_of_range_year(tmp_path, monkeypatch):
    """显式传入的越界年份（如 123/9999）必须被忽略并回退自动抽取，而不是入库。"""
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path)
    _tmp_db(tmp_path, monkeypatch)
    from rag.retrieval import retriever
    monkeypatch.setattr(app_module.retriever, "rebuild", lambda: None)

    async def _upload(year: str) -> dict:
        upload = UploadFile(file=io.BytesIO("立项背景与研究内容的测试文本。".encode("utf-8")), filename="test.txt")
        result = await app_module.upload_document(file=upload, kind="auto", year=year, title="", _user={"role": "admin", "username": "t"})
        return result["document"]

    doc_bad = asyncio.run(_upload("123"))
    assert doc_bad["year"] is None  # 文件名与正文都无年份，回退为空
    doc_good = asyncio.run(_upload("2024"))
    assert doc_good["year"] == 2024
    with db.connect() as conn:
        conn.execute("DELETE FROM documents")
        conn.execute("DELETE FROM chunks")


def test_infer_kind_falls_back_to_content_sniffing():
    assert app_module._infer_kind("某文件.docx", "第一条 为规范科研项目管理，制定本办法。") == "policy"
    assert app_module._infer_kind("某文件.docx", "一、立项背景\n二、研究内容") == "proposal"
    assert app_module._infer_kind("某文件.docx", "这是一段普通文本。") == "other"
    assert app_module._infer_kind("管理办法.pdf", "") == "policy"


def test_ingest_experts_and_papers_idempotent(tmp_path, monkeypatch):
    """外部推送接口必须幂等：重复推送同一批数据只计跳过。"""
    _tmp_db(tmp_path, monkeypatch)
    experts = [
        schemas.ExternalExpert(
            name="王五", institution="省厅信息中心",
            research_areas=["科研诚信", "数据治理"], workload=2,
        ),
        schemas.ExternalExpert(name="赵六", institution="某大学"),
    ]
    assert ingest.ingest_experts(experts) == (2, 0)
    assert ingest.ingest_experts(experts) == (0, 2)
    row = next(e for e in db.list_experts() if e["name"] == "王五")
    assert row["research_areas"] == "科研诚信;数据治理"
    assert row["source"] == "system"
    papers = [schemas.ExternalPaper(title="真实文献A", year=2024, keywords=["大模型"])]
    assert ingest.ingest_papers(papers) == (1, 0)
    assert ingest.ingest_papers(papers) == (0, 1)
    assert db.count_papers() == 1


def test_ingest_token_enforced_only_when_configured(monkeypatch):
    """INGEST_TOKEN 未配置时不拦（本机原型），配置后错令牌必须 401。"""
    monkeypatch.setattr(config, "INGEST_TOKEN", "")
    assert app_module._require_ingest_token(x_ingest_token="") is None
    monkeypatch.setattr(config, "INGEST_TOKEN", "s3cret")
    with pytest.raises(HTTPException) as exc:
        app_module._require_ingest_token(x_ingest_token="wrong")
    assert exc.value.status_code == 401
    assert app_module._require_ingest_token(x_ingest_token="s3cret") is None


def test_ingest_schema_documents_contract():
    """schema 端点必须自描述：可接收实体 + 预留实体齐全。"""
    contract = app_module.ingest_schema()
    assert set(contract["accepted"]) == {"experts", "papers"}
    assert set(contract["reserved"]) == {"projects", "integrity_records", "policy_meta"}
    expert_props = contract["accepted"]["experts"]["schema"]["properties"]
    assert {"name", "institution", "research_areas", "workload", "available"} <= set(expert_props)
    assert contract["reserved"]["projects"]["schema"]["required"] == ["project_id", "title"]
    assert contract["auth"]["header"] == "X-INGEST-Token"


def test_auth_password_hash_and_login_roundtrip(tmp_path, monkeypatch):
    """密码加盐哈希可验证；错误密码与非法注册被拒绝。"""
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth
    assert auth.create_user("wang", "secret1", "reviewer", "王评审") is True
    assert auth.create_user("wang", "another1", "viewer") is False      # 重名
    assert auth.create_user("li", "123", "viewer") is False             # 密码过短
    assert auth.create_user("zhao", "secret1", "superuser") is False    # 非法角色
    user = auth.verify_login("wang", "secret1")
    assert user == {"username": "wang", "role": "reviewer", "display_name": "王评审"}
    assert auth.verify_login("wang", "wrongpwd") is None
    assert auth.verify_login("nobody", "secret1") is None


def test_auth_session_lifecycle(tmp_path, monkeypatch):
    """会话可解析、可注销；伪造令牌无效。"""
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth
    auth.create_user("admin", "yanxin2026", "admin")
    token = auth.create_session("admin")
    assert auth.resolve_session(token)["role"] == "admin"
    assert auth.resolve_session("forged-token") is None
    auth.delete_session(token)
    assert auth.resolve_session(token) is None


def test_auth_login_endpoint_sets_cookie(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth
    auth.create_user("manager", "yanxin2026", "manager")
    resp = app_module.login(app_module.LoginRequest(username="manager", password="yanxin2026"))
    cookie = resp.headers.get("set-cookie", "")
    assert auth.SESSION_COOKIE in cookie and "httponly" in cookie.lower()
    import json as _json
    assert _json.loads(resp.body)["user"]["role"] == "manager"
    with pytest.raises(HTTPException):
        app_module.login(app_module.LoginRequest(username="manager", password="bad"))
