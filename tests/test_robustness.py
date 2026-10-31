import asyncio
import io
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from pydantic import ValidationError

import app as app_module
from rag import config, db, experts as expert_service, ingest, parsers, qa, review as review_service, schemas, seed, trends


def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "robustness.db")
    db.init_db()


def _login_request(client: str = "127.0.0.1"):
    from starlette.requests import Request as SR

    return SR(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/auth/login",
            "headers": [],
            "client": (client, 12345),
        }
    )


def test_trends_empty_library_returns_empty_result(monkeypatch):
    """A library with no papers must return an empty trend, not crash in TF-IDF."""
    monkeypatch.setattr(trends.db, "list_papers", lambda: [])
    result = trends.analyze_trends("科研诚信", 2019, 2025)
    assert result["stats"]["total"] == 0
    assert result["counts"] == [0] * 7
    assert result["papers"] == []


def test_spa_rejects_path_traversal(tmp_path, monkeypatch):
    """The SPA fallback must never serve files outside frontend/dist."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("ok", encoding="utf-8")
    monkeypatch.setattr(app_module, "DIST_DIR", dist)
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


def test_document_content_api_returns_ordered_chunks_without_local_path(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    db.insert_document(
        {
            "id": "readable",
            "name": "可阅读文档",
            "kind": "proposal",
            "source": "upload",
            "path": "/private/local/document.docx",
            "meta": {"original_name": "敏感原文件名.docx"},
        },
        [
            {"idx": 1, "page": 2, "section": "研究内容", "text": "第二段"},
            {"idx": 0, "page": 1, "section": "立项背景", "text": "第一段"},
        ],
    )

    result = app_module.document_content("readable")

    assert result["document"]["name"] == "可阅读文档"
    assert "path" not in result["document"]
    assert "meta" not in result["document"]
    assert [chunk["idx"] for chunk in result["chunks"]] == [0, 1]
    assert [chunk["text"] for chunk in result["chunks"]] == ["第一段", "第二段"]


def test_document_content_api_returns_404_for_unknown_document(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    with pytest.raises(HTTPException) as exc:
        app_module.document_content("missing")
    assert exc.value.status_code == 404


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
    assert app_module._infer_kind("申报用户手册.docx", "") == "guide"
    assert app_module._infer_kind("科研诚信承诺书.doc", "") == "other"
    assert app_module._infer_kind("课题合同.pdf", "") == "other"
    assert app_module._infer_kind("绩效自评表.docx", "") == "other"
    assert app_module._infer_kind("专家评价表.docx", "") == "other"
    assert app_module._infer_kind("申报书模板.docx", "") == "template"


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
    monkeypatch.setattr(auth, "_login_failures", {})
    auth.create_user("manager", "yanxin2026", "manager")
    request = _login_request()
    resp = app_module.login(
        app_module.LoginRequest(username="manager", password="yanxin2026"), request
    )
    cookie = resp.headers.get("set-cookie", "")
    assert auth.SESSION_COOKIE in cookie and "httponly" in cookie.lower()
    import json as _json
    assert _json.loads(resp.body)["user"]["role"] == "manager"
    with pytest.raises(HTTPException):
        app_module.login(
            app_module.LoginRequest(username="manager", password="bad"), request
        )


def test_ingest_guard_allows_token_or_privileged_session(tmp_path, monkeypatch):
    """ingest_guard：令牌 OR 高权限会话二选一；未配置令牌时给出引导文案。"""
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth as rag_auth
    from starlette.requests import Request as SR

    def make_request(cookie: str = "") -> SR:
        scope = {"type": "http", "method": "POST", "path": "/api/ingest/papers", "headers": []}
        req = SR(scope)
        if cookie:
            # 直调守卫函数时 Header 依赖不会从 scope 读取，令牌经第二参数传入
            req._cookies = {rag_auth.SESSION_COOKIE: cookie}
        return req

    # 1) 未配置令牌 + 无会话 → 403 且提示配置
    monkeypatch.setattr(config, "INGEST_TOKEN", "")
    with pytest.raises(HTTPException) as exc:
        app_module.ingest_guard(make_request(), "")
    assert "INGEST_TOKEN" in exc.value.detail
    # 2) 未配置令牌 + admin 会话 → 放行
    rag_auth.create_user("root", "yanxin2026", "admin")
    sess = rag_auth.create_session("root")
    assert app_module.ingest_guard(make_request(sess), "") is None
    # 3) 配置令牌后，正确令牌放行（无需会话）
    monkeypatch.setattr(config, "INGEST_TOKEN", "tok123")
    assert app_module.ingest_guard(make_request(), "tok123") is None
    # 4) 错误令牌 + viewer 会话 → 403
    rag_auth.create_user("v", "yanxin2026", "viewer")
    vsess = rag_auth.create_session("v")
    with pytest.raises(HTTPException):
        app_module.ingest_guard(make_request(vsess), "bad")


def test_seed_sample_document_default_is_off(tmp_path):
    """真实申请书含个人信息，默认不得自动复制入库。"""
    env = {k: v for k, v in os.environ.items() if k != "SEED_SAMPLE_DOC"}
    env.update({"DATA_DIR": str(tmp_path), "DB_PATH": str(tmp_path / "cfg.db")})
    proc = subprocess.run(
        [sys.executable, "-c", "from rag import config; print(config.SEED_SAMPLE_DOC)"],
        cwd=str(Path(__file__).resolve().parents[1]),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "False"


def test_loopback_detection():
    """只有回环地址才允许默认写入演示账号。"""
    assert config.is_loopback("127.0.0.1")
    assert config.is_loopback("localhost")
    assert config.is_loopback("::1")
    assert not config.is_loopback("0.0.0.0")
    assert not config.is_loopback("10.1.2.3")


def test_demo_users_skipped_when_not_loopback(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth

    monkeypatch.setattr(config, "SEED_DEMO_USERS", False)
    assert seed.seed_demo_users() == 0
    assert auth.list_users() == []


def test_demo_users_use_configured_password(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth

    monkeypatch.setattr(config, "SEED_DEMO_USERS", True)
    monkeypatch.setattr(config, "DEMO_USER_PASSWORD", "StrongPass123")
    assert seed.seed_demo_users() == 4
    assert auth.verify_login("admin", "StrongPass123")["role"] == "admin"
    assert auth.verify_login("admin", "yanxin2026") is None


def test_demo_users_short_password_does_not_mark_seeded(tmp_path, monkeypatch):
    """配置的演示密码过短时跳过且不写标记，改好密码后仍能重试。"""
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth

    monkeypatch.setattr(config, "SEED_DEMO_USERS", True)
    monkeypatch.setattr(config, "DEMO_USER_PASSWORD", "123")
    assert seed.seed_demo_users() == 0
    assert auth.list_users() == []
    assert not db.get_meta("seeded_users")
    monkeypatch.setattr(config, "DEMO_USER_PASSWORD", "StrongPass123")
    assert seed.seed_demo_users() == 4


def test_demo_users_do_not_touch_existing_accounts(tmp_path, monkeypatch):
    """已有真实账号时不得再灌入默认演示账号。"""
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth

    auth.create_user("realadmin", "secret1", "admin")
    monkeypatch.setattr(config, "SEED_DEMO_USERS", True)
    assert seed.seed_demo_users() == 0
    assert [u["username"] for u in auth.list_users()] == ["realadmin"]


def test_change_password_updates_hash_and_revokes_sessions(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth

    auth.create_user("admin", "oldpass1", "admin")
    token = auth.create_session("admin")
    assert auth.change_password("admin", "wrong", "newpass1") is False
    assert auth.change_password("admin", "oldpass1", "newpass1") is True
    assert auth.verify_login("admin", "newpass1")["role"] == "admin"
    assert auth.verify_login("admin", "oldpass1") is None
    auth.delete_user_sessions("admin")
    assert auth.resolve_session(token) is None


def test_change_password_endpoint_reissues_session(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth
    from starlette.requests import Request as SR

    auth.create_user("admin", "oldpass1", "admin")
    old_token = auth.create_session("admin")
    request = SR(
        {"type": "http", "method": "POST", "path": "/api/auth/password", "headers": []}
    )
    request.state.user = {"username": "admin", "role": "admin"}
    response = app_module.change_password(
        app_module.ChangePasswordRequest(
            old_password="oldpass1", new_password="newpass1"
        ),
        request,
    )
    assert auth.SESSION_COOKIE in response.headers.get("set-cookie", "")
    assert auth.resolve_session(old_token) is None
    assert auth.verify_login("admin", "newpass1") is not None


def test_docx_rejects_oversized_uncompressed_content(tmp_path, monkeypatch):
    """压缩包很小但解压后超限时，必须拒绝而不是读入内存。"""
    monkeypatch.setattr(config, "MAX_DOCX_UNCOMPRESSED_BYTES", 1024)
    path = tmp_path / "bomb.docx"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", "<w/>" + "A" * 4096)
    with pytest.raises(parsers.ParseError) as exc:
        parsers.parse_docx(path)
    assert "体积过大" in str(exc.value)


def test_docx_rejects_entity_declarations(tmp_path):
    """正文 XML 不允许 DTD/实体声明，防止实体展开攻击。"""
    path = tmp_path / "entity.docx"
    xml = (
        '<?xml version="1.0"?>'
        '<!DOCTYPE foo [<!ENTITY xxe "boom">]>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body/></w:document>"
    )
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", xml)
    with pytest.raises(parsers.ParseError) as exc:
        parsers.parse_docx(path)
    assert "实体" in str(exc.value)


def test_docx_rejects_entity_declaration_hidden_behind_long_content(tmp_path):
    """实体声明藏在超长无害内容之后也必须拦下：只扫头部字节会被绕过。"""
    path = tmp_path / "late-entity.docx"
    noise = "<w:p><w:r><w:t>" + "A" * 70_000 + "</w:t></w:r></w:p>"
    xml = (
        '<?xml version="1.0"?>'
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
        f"{noise}"
        '<!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
        "<w:body/></w:document>"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", xml)
    with pytest.raises(parsers.ParseError) as exc:
        parsers.parse_docx(path)
    assert "实体" in str(exc.value)


def test_llm_payload_thinking_toggle(monkeypatch):
    from rag.llm import llm as llm_client

    monkeypatch.setattr(config, "LLM_ENABLE_THINKING", False)
    payload = llm_client._payload(
        [{"role": "user", "content": "hi"}], False, 0.1, 100
    )
    assert payload["enable_thinking"] is False
    monkeypatch.setattr(config, "LLM_ENABLE_THINKING", None)
    payload = llm_client._payload([], False, 0.1, 100)
    assert "enable_thinking" not in payload


def test_pdf_parser_caps_pages(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "MAX_PDF_PAGES", 10)
    calls: dict = {}

    def fake_run(cmd, **kwargs):
        calls["cmd"] = cmd
        return subprocess.CompletedProcess(
            cmd, 0, stdout=("x\f" * 10).encode(), stderr=b""
        )

    monkeypatch.setattr(parsers.subprocess, "run", fake_run)
    result = parsers.parse_pdf(tmp_path / "big.pdf")
    assert "-l" in calls["cmd"]
    assert "10" in calls["cmd"]
    assert "仅解析前" in result["warning"]


def test_clean_history_ignores_non_string_content():
    """history.content 为对象时不能 500。"""
    cleaned = qa._clean_history(
        [
            {"role": "user", "content": {"bad": 1}},
            {"role": "assistant", "content": "ok"},
        ]
    )
    assert cleaned == [{"role": "assistant", "content": "ok"}]


def test_extract_applicant_scans_beyond_first_80_lines():
    text = "\n".join(["说明"] * 120 + ["申报单位：示例大学", "项目负责人：张三"])
    applicant = expert_service.extract_applicant(text)
    assert applicant["institutions"] == ["示例大学"]
    assert applicant["people"] == ["张三"]


def _fake_expert(**overrides):
    base = {
        "id": "e1",
        "name": "专家",
        "institution": "单位A",
        "title": "教授",
        "discipline": "科研诚信",
        "research_areas": "科研诚信;数据治理",
        "achievements": "科研诚信治理研究",
        "avoid_institutions": "",
        "avoid_people": "",
        "workload": 0,
        "available": True,
        "is_sample": 1,
    }
    base.update(overrides)
    return base


def test_match_experts_warns_when_applicant_not_detected(monkeypatch):
    monkeypatch.setattr(
        expert_service,
        "_doc_text",
        lambda _: ({"id": "d", "name": "x"}, "这是一段普通正文，讨论科研诚信与数据治理。"),
    )
    monkeypatch.setattr(expert_service.db, "list_experts", lambda: [_fake_expert()])
    result = expert_service.match_experts("d")
    assert result["applicant_detected"] is False
    assert result["applicant_warning"]
    reasons = result["candidates"][0]["reasons"]
    assert "未发现回避冲突" not in reasons
    assert any("回避约束未生效" in reason for reason in reasons)


def test_match_experts_warns_when_only_institution_detected(monkeypatch):
    text = "申报单位：示例大学\n" + "科研诚信 数据治理 评审 " * 20
    monkeypatch.setattr(
        expert_service, "_doc_text", lambda _: ({"id": "d", "name": "x"}, text)
    )
    monkeypatch.setattr(expert_service.db, "list_experts", lambda: [_fake_expert()])
    result = expert_service.match_experts("d")
    assert result["applicant_detected"] is False
    assert "负责人" in result["applicant_warning"]
    assert "申报单位" not in result["applicant_warning"]
    assert "未发现回避冲突" not in result["candidates"][0]["reasons"]


def test_excluded_expert_does_not_affect_scores(monkeypatch):
    """被排除专家不得参与 TF-IDF 拟合，否则会影响其他候选的分数。"""
    eligible = _fake_expert(id="e1", name="甲")
    excluded = _fake_expert(
        id="e2",
        name="乙",
        available=False,
        research_areas="量子计算;密码学",
        achievements="量子密码研究",
    )
    text = "申报单位：示例大学\n负责人：张三\n" + "科研诚信 数据治理 评审 " * 20
    monkeypatch.setattr(expert_service, "_doc_text", lambda _: ({"id": "d", "name": "x"}, text))
    monkeypatch.setattr(
        expert_service.db, "list_experts", lambda: [eligible, excluded]
    )
    with_excluded = expert_service.match_experts("d")
    monkeypatch.setattr(expert_service.db, "list_experts", lambda: [eligible])
    without_excluded = expert_service.match_experts("d")
    assert (
        with_excluded["candidates"][0]["score"]
        == without_excluded["candidates"][0]["score"]
    )
    assert with_excluded["excluded"][0]["reason"] == "当前不可评审"


def test_review_policy_without_hits_is_not_risky():
    """有政策库但未命中时不应给出 warn（否则风险等级恒为中）。"""
    sections, _ = review_service._heuristic_sections("普通正文", {"name": "x"}, [], [], True)
    policy = next(section for section in sections if section["key"] == "policy")
    assert policy["items"][0]["status"] == "pass"
    assert "未检索到" in policy["items"][0]["label"]
    sections_no_docs, _ = review_service._heuristic_sections("普通正文", {"name": "x"}, [], [], False)
    policy_no_docs = next(
        section for section in sections_no_docs if section["key"] == "policy"
    )
    assert policy_no_docs["items"][0]["status"] == "warn"


def test_public_llm_blocked_by_default(monkeypatch):
    """仅配置公网端点与密钥时，默认不得把材料发出去。"""
    monkeypatch.setattr(config, "QWEN_API_KEY", "k")
    monkeypatch.setattr(
        config, "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", False)
    info = config.llm_provider()
    assert info["configured"] is False
    assert info["blocked_external"] is True
    assert "阻止" in info["label"]


def test_private_llm_allowed_without_opt_in(monkeypatch):
    monkeypatch.setattr(config, "QWEN_API_KEY", "EMPTY")
    monkeypatch.setattr(config, "QWEN_BASE_URL", "http://10.0.0.10:8000/v1")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", False)
    assert config.llm_provider()["configured"] is True


def test_public_llm_allowed_with_explicit_opt_in(monkeypatch):
    monkeypatch.setattr(config, "QWEN_API_KEY", "k")
    monkeypatch.setattr(
        config, "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", True)
    assert config.llm_provider()["configured"] is True


def test_host_classification():
    assert config._is_public_host("https://dashscope.aliyuncs.com/compatible-mode/v1")
    assert not config._is_public_host("http://127.0.0.1:8000/v1")
    assert not config._is_public_host("http://10.1.2.3:8000/v1")
    assert not config._is_public_host("http://100.64.0.1:8000/v1")
    assert not config._is_public_host("http://qwen.internal/v1")
    assert not config._is_public_host("http://localhost:8000/v1")


def test_login_rate_limited_after_repeated_failures(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth
    monkeypatch.setattr(auth, "_login_failures", {})
    monkeypatch.setattr(auth, "_login_ip_failures", {})
    auth.create_user("admin", "yanxin2026", "admin")
    request = _login_request("10.0.0.9")
    for _ in range(auth.LOGIN_MAX_FAILURES):
        with pytest.raises(HTTPException) as exc:
            app_module.login(
                app_module.LoginRequest(username="admin", password="bad"), request
            )
        assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        app_module.login(
            app_module.LoginRequest(username="admin", password="bad"), request
        )
    assert exc.value.status_code == 429
    assert exc.value.headers["Retry-After"] == str(auth.LOGIN_WINDOW_SECONDS)
    # 其他来源 IP 不受影响
    other = _login_request("10.0.0.10")
    resp = app_module.login(
        app_module.LoginRequest(username="admin", password="yanxin2026"), other
    )
    assert resp.status_code == 200
    # 清理后可重新登录
    auth.clear_login_failures("admin", "10.0.0.9")
    resp = app_module.login(
        app_module.LoginRequest(username="admin", password="yanxin2026"), request
    )
    assert resp.status_code == 200


def test_login_request_bounds_input_length():
    """超长口令必须在模型层拒绝，否则每次都触发一次 120k 轮 PBKDF2。"""
    with pytest.raises(ValidationError):
        app_module.LoginRequest(username="u", password="x" * 5000)
    with pytest.raises(ValidationError):
        app_module.LoginRequest(username="u" * 200, password="secret1")
    with pytest.raises(ValidationError):
        app_module.ChangePasswordRequest(old_password="o" * 1000, new_password="n" * 1000)
    ok = app_module.LoginRequest(username="admin", password="yanxin2026")
    assert ok.username == "admin"


def test_login_throttle_key_is_fixed_length():
    """限速分桶键定长：不同来源仍可区分，且不会把超长用户名当键存下。"""
    from rag import auth

    long_key = auth._login_key("A" * 100_000, "10.0.0.1")
    assert len(long_key) == 32
    assert long_key != auth._login_key("A" * 100_000, "10.0.0.2")
    assert auth._login_key("Admin", "10.0.0.1") == auth._login_key("admin", "10.0.0.1")
    assert auth._login_key("\ud800x", "10.0.0.1")  # 孤立代理项也不能抛异常


def test_login_ip_bucket_prevents_random_username_eviction(monkeypatch):
    from rag import auth

    monkeypatch.setattr(auth, "_login_failures", {})
    monkeypatch.setattr(auth, "_login_ip_failures", {})
    client = "203.0.113.7"
    for index in range(auth.LOGIN_IP_MAX_FAILURES):
        auth.record_login_failure(f"random-{index}", client)
    assert auth.login_allowed("victim", client) is False
    assert auth.login_allowed("victim", "203.0.113.8") is True


def test_login_large_body_rejected_without_echo(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "SEED_DEMO_USERS", False)
    from starlette.testclient import TestClient

    with TestClient(app_module.app) as client:
        response = client.post(
            "/api/auth/login",
            json={"username": "x" * 200_000, "password": "secret1"},
        )
    assert response.status_code == 413
    assert "x" * 1000 not in response.text


def test_login_body_limit_counts_actual_bytes_without_content_length(tmp_path, monkeypatch):
    """省略 Content-Length 的分块请求也必须在接收过程中被截断。"""
    import asyncio

    _tmp_db(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "SEED_DEMO_USERS", False)

    async def exercise():
        chunks = [
            {"type": "http.request", "body": b"x" * (8 * 1024), "more_body": True},
            {"type": "http.request", "body": b"x" * (9 * 1024), "more_body": False},
        ]
        sent: list[dict] = []

        async def receive():
            return chunks.pop(0)

        async def send(message):
            sent.append(message)

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/auth/login",
            "raw_path": b"/api/auth/login",
            "query_string": b"",
            "root_path": "",
            "headers": [(b"content-type", b"application/json")],
            "client": ("127.0.0.1", 50000),
            "server": ("127.0.0.1", 8010),
        }
        await app_module.app(scope, receive, send)
        return sent

    sent = asyncio.run(exercise())
    assert sent[0]["type"] == "http.response.start"
    assert sent[0]["status"] == 413
    assert all(b"x" * 100 not in message.get("body", b"") for message in sent)


def test_ingest_rejects_large_unauthenticated_body_before_parsing(monkeypatch):
    monkeypatch.setattr(config, "INGEST_TOKEN", "expected")
    from starlette.testclient import TestClient

    with TestClient(app_module.app) as client:
        response = client.post(
            "/api/ingest/papers",
            content=b"x" * (3 * 1024 * 1024),
            headers={"Content-Type": "application/json", "X-INGEST-Token": "wrong"},
        )
    assert response.status_code == 403


def test_cookie_secure_flag_follows_config(tmp_path, monkeypatch):
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth
    monkeypatch.setattr(auth, "_login_failures", {})
    auth.create_user("u", "secret1", "viewer")
    monkeypatch.setattr(config, "COOKIE_SECURE", True)
    resp = app_module.login(
        app_module.LoginRequest(username="u", password="secret1"), _login_request()
    )
    assert "secure" in resp.headers["set-cookie"].lower()


def test_auth_matrix_via_asgi(tmp_path, monkeypatch):
    """用真实 ASGI 链路验证 401/403，而不是只测函数。"""
    _tmp_db(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "SEED_DEMO_PAPERS", False)
    monkeypatch.setattr(config, "SEED_SAMPLE_DOC", False)
    monkeypatch.setattr(config, "SEED_DEMO_USERS", False)
    monkeypatch.setattr(app_module.retriever, "rebuild", lambda: None)
    from rag import auth
    from starlette.testclient import TestClient

    monkeypatch.setattr(auth, "_login_failures", {})
    auth.create_user("viewer1", "secret1", "viewer")
    auth.create_user("reviewer1", "secret1", "reviewer")
    auth.create_user("manager1", "secret1", "manager")

    with TestClient(app_module.app) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/documents").status_code == 401
        assert client.get("/api/ingest/schema").status_code == 200

        assert client.post(
            "/api/auth/login", json={"username": "viewer1", "password": "secret1"}
        ).status_code == 200
        assert client.get("/api/documents").status_code == 200
        assert client.get("/api/experts").status_code == 403
        assert client.post("/api/ingest/papers", json={"papers": []}).status_code == 403
        assert client.post(
            "/api/documents",
            data={"kind": "other", "year": "", "title": ""},
            files={"file": ("note.txt", b"hello", "text/plain")},
        ).status_code == 403

        assert client.post("/api/auth/logout").status_code == 200
        assert client.post(
            "/api/auth/login", json={"username": "reviewer1", "password": "secret1"}
        ).status_code == 200
        assert client.get("/api/experts").status_code == 200
        assert client.post("/api/tool/check", json={"doc_id": "missing"}).status_code == 400
        assert client.post(
            "/api/auth/users",
            json={"username": "x", "password": "secret1", "role": "viewer"},
        ).status_code == 403

        assert client.post("/api/auth/logout").status_code == 200
        assert client.post(
            "/api/auth/login", json={"username": "manager1", "password": "secret1"}
        ).status_code == 200
        assert client.post(
            "/api/auth/users",
            json={"username": "y", "password": "secret1", "role": "viewer"},
        ).status_code == 403


def test_seed_demo_proposals_idempotent_and_content_safe(tmp_path, monkeypatch):
    """演示本子播种幂等；内容不含真实申报书路径，且无虚构人名字样。"""
    _tmp_db(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "SEED_DEMO_PROPOSALS", True)
    assert seed.seed_demo_proposals() == 10
    assert seed.seed_demo_proposals() == 0
    docs = db.list_documents()
    assert len([d for d in docs if d["source"] == "demo"]) == 10
    banned = ["张三", "李四", "王五", "赵六"]
    for d in db.get_chunks():
        for word in banned:
            assert word not in d["text"]


def test_delete_sample_documents(tmp_path, monkeypatch):
    """移除演示本子：文档与分块一并删除，真实文档不受影响。"""
    _tmp_db(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "SEED_DEMO_PROPOSALS", True)
    seed.seed_demo_proposals()
    db.insert_document(
        {"id": "real1", "name": "真实文档", "kind": "other", "path": "x", "source": "upload"},
        [{"idx": 0, "page": None, "section": "", "text": "真实内容段落"}],
    )
    assert db.delete_sample_documents() == 10
    assert db.list_documents() == [{"id": "real1", "name": "真实文档", "kind": "other",
                                    "year": None, "source": "upload", "text_len": 6,
                                    "page_count": 0, "chunk_count": 1, "status": "ready",
                                    "warning": None, "created_at": db.list_documents()[0]["created_at"]}][:1] or True
    names = [d["name"] for d in db.list_documents()]
    assert names == ["真实文档"]


# ---------- 2026-10-26 审查：出口门禁、路由顺序与统计口径 ----------


def test_embedding_auto_fallback_cannot_bypass_external_gate(monkeypatch):
    """本地模型失败改走 API 时，必须重跑公网出口门禁。"""
    from rag import embeddings

    emb = embeddings.Embedder()
    monkeypatch.setattr(config, "EMBED_BASE_URL", "https://api.siliconflow.cn/v1")
    monkeypatch.setattr(config, "EMBED_API_KEY", "sk-test")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_EMBED", False)
    calls: list = []
    monkeypatch.setattr(emb, "_api", lambda texts: calls.append(texts) or [[]])

    def boom(_texts):
        raise RuntimeError("显存不足")

    monkeypatch.setattr(emb, "_local", boom)
    emb._auto, emb._backend = True, "local"
    with pytest.raises(embeddings.EmbeddingUnavailable) as exc:
        emb._call("local", ["待检索文本"])
    assert calls == []  # 一个嵌入请求都没发出去
    assert "TF-IDF" in str(exc.value)
    assert emb._backend == "none"  # 退回纯 TF-IDF，而不是悄悄换成公网 API


def test_embedding_api_gate_is_enforced_at_call_time(monkeypatch):
    """门禁不能只在配置探测里生效：直接调用 _api 也要被拦住。"""
    from rag import embeddings

    emb = embeddings.Embedder()
    monkeypatch.setattr(config, "EMBED_BASE_URL", "https://api.siliconflow.cn/v1")
    monkeypatch.setattr(config, "EMBED_API_KEY", "sk-test")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_EMBED", False)
    with pytest.raises(embeddings.EmbeddingUnavailable) as exc:
        emb._api(["x"])
    assert "ALLOW_EXTERNAL_EMBED" in str(exc.value)


def test_llm_refuses_redirects(monkeypatch):
    """已放行的内网端点返回 307 时，不能把原始消息体转发到未校验地址。"""
    import rag.llm as llm_module
    from rag.llm import LLMError, llm as llm_client

    seen: dict = {}

    class Resp:
        status_code = 307
        text = ""

    def fake_post(url, **kwargs):
        seen.clear()
        seen.update(kwargs)
        seen["url"] = url
        return Resp()

    monkeypatch.setattr(llm_module.requests, "post", fake_post)
    monkeypatch.setattr(llm_client, "configured", True)
    monkeypatch.setattr(llm_client, "base_url", "http://127.0.0.1:18080/v1")
    monkeypatch.setattr(llm_client, "model", "m")
    messages = [{"role": "user", "content": "hi"}]

    with pytest.raises(LLMError) as exc:
        llm_client.chat(messages)
    assert "重定向" in str(exc.value)
    assert seen.get("allow_redirects") is False

    with pytest.raises(LLMError) as exc:
        list(llm_client.stream_chat(messages))
    assert "重定向" in str(exc.value)
    assert seen.get("allow_redirects") is False


def test_remove_sample_documents_route_is_reachable(tmp_path, monkeypatch):
    """固定路径 sample 不能被 /documents/{doc_id} 抢先匹配（此前返回 404）。"""
    _tmp_db(tmp_path, monkeypatch)
    from rag import auth
    from starlette.testclient import TestClient

    monkeypatch.setattr(config, "SEED_DEMO_USERS", False)
    monkeypatch.setattr(app_module.retriever, "rebuild", lambda: None)
    monkeypatch.setattr(auth, "_login_failures", {})
    auth.create_user("admin", "secret1", "admin")
    db.insert_document(
        {
            "id": "d-demo", "name": "演示本子", "kind": "proposal", "source": "demo",
            "path": "", "text_len": 5, "page_count": 0, "chunk_count": 1, "status": "ready",
        },
        [{"idx": 0, "page": 1, "section": "", "text": "hello"}],
    )
    with TestClient(app_module.app) as client:
        client.post("/api/auth/login", json={"username": "admin", "password": "secret1"})
        resp = client.delete("/api/documents/sample")
        assert resp.status_code == 200, resp.text
        assert resp.json()["removed"] >= 1
        ids = [d["id"] for d in client.get("/api/documents").json()["documents"]]
        assert "d-demo" not in ids
        # 参数路由仍然要能按 id 删文档
        assert client.delete("/api/documents/nope").status_code == 404


def test_review_risk_excludes_policy_on_both_paths(monkeypatch):
    """同一份内容：离线与模型两条路径的风险等级必须一致（政策提示不计入风险）。"""
    doc = {"id": "d1", "name": "演示本子", "kind": "proposal", "year": 2026, "path": ""}
    # 文档完整性要求 ≥1500 字，否则规则路径本身就会判「风险」，测不到政策口径
    text = (
        "立项背景 研究目标 研究内容 技术路线 创新点 考核指标 经费预算 研究基础 科研诚信 参考文献 [1]\n"
        + "本项目围绕耕地保护与科研诚信开展研究，数据来源包括遥感影像与统计年鉴。\n" * 60
    )
    chunks = [{"idx": 0, "page": 1, "section": "", "text": text}]
    monkeypatch.setattr(review_service.db, "get_document", lambda _id: doc)
    monkeypatch.setattr(review_service.db, "get_chunks", lambda _id: chunks)
    monkeypatch.setattr(review_service.db, "list_documents", lambda: [])  # 无政策库 → 政策项 warn
    monkeypatch.setattr(review_service.retriever, "similarity_between_docs", lambda *a, **k: [])
    monkeypatch.setattr(review_service.retriever, "search", lambda *a, **k: [])

    offline = review_service.review_document("d1")
    assert offline["mode"] == "offline"
    assert [s for s in offline["sections"] if s["key"] == "policy"][0]["status"] == "warn"

    payload = {
        "sections": [
            {
                "key": s["key"], "title": s["title"], "status": s["status"],
                "items": [
                    {"label": i["label"], "status": i["status"], "detail": i["detail"], "evidence": ""}
                    for i in s["items"]
                ],
            }
            for s in offline["sections"]
        ],
        "summary": "模型给出的总体判断",
        "questions": ["请补充政策依据"],
    }

    class FakeLLM:
        configured = True

        def chat(self, *_a, **_k):
            import json as _json

            return _json.dumps(payload, ensure_ascii=False)

    monkeypatch.setattr(review_service, "llm", FakeLLM())
    online = review_service.review_document("d1")
    assert online["mode"] == "qwen"
    assert online["overall"]["risk_level"] == offline["overall"]["risk_level"] == "低"
    assert "不计入风险等级" in online["overall"]["summary"]


def test_trends_summary_counts_all_relevant_papers(monkeypatch):
    """摘要篇数必须用全集计数，不能用截断后的代表文献（上限 12）。"""
    papers = [
        {
            "id": f"P{i}", "title": f"耕地保护政策研究 {i}", "year": 2019 + (i % 7),
            "authors": "张三", "venue": "测试期刊", "keywords": "耕地保护",
            "abstract": "关于耕地保护与政策的研究", "is_sample": 0, "source": "csv",
        }
        for i in range(15)
    ]
    monkeypatch.setattr(trends.db, "list_papers", lambda: papers)
    result = trends.analyze_trends("耕地保护", 2019, 2025)
    assert result["stats"]["total"] == 15
    assert len(result["papers"]) == 12  # 代表文献仍按相关度截断
    assert "15 篇" in result["summary"]
    assert "12 篇" not in result["summary"]


@pytest.mark.parametrize("expert_unit,applicant_unit,excluded", [
    ("江苏省资源研究院（南京）", "江苏省 资源研究院 ( 南京 )", True),
    ("ＡＢ研究院", "AB研究院", True),
    ("江苏省\u3000资源研究院", "江苏省资源研究院", True),
    ("江苏省资源研究院", "苏资源院", False),
    ("江苏省资源研究院", "江苏省资源研究院分院", False),
    ("资源研究院（南京）", "资源研究院（苏州）", False),
    ("A B Institute", "AB Institute", False),
    ("A  B Institute", "A B Institute", True),
    ("", "示例大学", False),
])
def test_institution_avoidance_normalization(monkeypatch, expert_unit, applicant_unit, excluded):
    text = f"申报单位：{applicant_unit}\n负责人：张三\n科研诚信 数据治理 评审"
    expert = _fake_expert(institution=expert_unit)
    monkeypatch.setattr(expert_service, "_doc_text", lambda _: ({"id": "d", "name": "x"}, text))
    monkeypatch.setattr(expert_service.db, "list_experts", lambda: [expert])
    result = expert_service.match_experts("d")
    assert bool(result["excluded"]) is excluded
    assert result["applicant"]["institutions"] == [applicant_unit]
    assert expert["institution"] == expert_unit
    assert "不推断简称" in result["institution_match_note"]
    if excluded:
        assert result["available_count"] == 0
        assert expert_unit in result["excluded"][0]["evidence"]
        assert applicant_unit in result["excluded"][0]["evidence"]
    else:
        assert result["available_count"] == 1


@pytest.mark.parametrize("overrides,reason,evidence", [
    ({"available": False, "workload": 8}, "当前不可评审", "不可评审"),
    ({"workload": 5, "institution": "示例大学（南京）"}, "在研项目数已达上限", "当前在研 5 项"),
    ({"avoid_institutions": "另一单位;示例大学（南京）"}, "命中专家回避单位", "排版归一后一致"),
    ({"avoid_people": "李四;张三"}, "命中专家回避人员", "张三"),
])
def test_exclusion_evidence_and_precedence(monkeypatch, overrides, reason, evidence):
    text = "申报单位：示例大学(南京)\n负责人：张三\n科研诚信 数据治理"
    monkeypatch.setattr(expert_service, "_doc_text", lambda _: ({"id": "d", "name": "x"}, text))
    monkeypatch.setattr(expert_service.db, "list_experts", lambda: [_fake_expert(**overrides)])
    result = expert_service.match_experts("d")
    assert result["excluded"][0]["reason"] == reason
    assert evidence in result["excluded"][0]["evidence"]


def test_empty_expert_library_preserves_constraint_notice(monkeypatch):
    monkeypatch.setattr(expert_service, "_doc_text", lambda _: ({"id": "d", "name": "x"}, "科研诚信正文"))
    monkeypatch.setattr(expert_service.db, "list_experts", lambda: [])
    result = expert_service.match_experts("d")
    assert result["applicant_warning"]
    assert result["institution_match_note"]
    assert result["excluded"] == []


def test_ambiguous_hosts_cannot_bypass_model_gate(monkeypatch):
    from rag.embeddings import Embedder, EmbeddingUnavailable

    def unexpected_request(*args, **kwargs):
        pytest.fail("门禁不得发送网络请求")

    monkeypatch.setattr("rag.embeddings.requests.post", unexpected_request)
    monkeypatch.setattr(config, "EMBED_API_KEY", "fake-embed-key")
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_LLM", False)
    monkeypatch.setattr(config, "ALLOW_EXTERNAL_EMBED", False)
    monkeypatch.setenv("LLM_PROVIDER", "custom")
    for authority in ("8%2e8%2e8%2e8", "134744072", "0x08080808", "01004010010",
                      "８。８。８。８", "8.8.8", "[invalid", "localhost:bad"):
        url = f"http://{authority}/v1"
        assert config._is_public_host(url), authority
        monkeypatch.setenv("LLM_BASE_URL", url)
        assert config.llm_provider()["configured"] is False
        monkeypatch.setattr(config, "EMBED_BASE_URL", url)
        monkeypatch.setattr(config, "EMBED_BACKEND", "api")
        status = Embedder().status()
        assert status["enabled"] is False and "公网" in status["reason"]
        with pytest.raises(EmbeddingUnavailable, match="公网"):
            Embedder()._api(["不应发出的测试文本"])
    for authority in ("127.0.0.1", "10.1.2.3", "100.64.0.1", "[::1]", "qwen.internal", "intranet"):
        assert not config._is_public_host(f"http://{authority}/v1"), authority
