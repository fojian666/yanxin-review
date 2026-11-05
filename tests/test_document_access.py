import hashlib
import json

import pytest
import numpy as np
from starlette.testclient import TestClient

import app as application
from rag import auth, db, document_access, experts, qa, retrieval, review, review_cases


@pytest.fixture
def secured(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "access.db")
    monkeypatch.setattr(application, "seed_all", lambda: {})
    db.init_db()
    for name, role in [("manager", "manager"), ("applicant", "viewer"), ("outsider", "viewer"), ("expert", "reviewer")]:
        assert auth.create_user(name, "testing123", role)
    common = "科研诚信与自然资源数据治理。研究内容、技术路线、考核指标、经费预算及研究基础。" * 12
    for doc_id, name, source, kind, owner, text in [
        ("own", "本人材料", "upload", "proposal", "applicant", common),
        ("opponent", "保密题名乙", "upload", "proposal", "outsider", "独有保密片段乙。" + common),
        ("legacy", "未归属旧材料", "upload", "other", "", "未归属暗码丙"),
        ("public-policy", "公开政策", "public", "policy", "", "科研诚信公开政策规定，应当遵守科研诚信要求。"),
    ]:
        db.insert_document({"id": doc_id, "name": name, "source": source, "kind": kind,
                            "path": str(tmp_path / f"{doc_id}.txt"), "owner_username": owner, "text_len": len(text)},
                           [{"idx": 0, "text": text, "section": "研究内容"}])
    index = retrieval.Retriever()
    for module in (application, experts, qa, review):
        monkeypatch.setattr(module, "retriever", index)
    index.rebuild()
    with TestClient(application.app, raise_server_exceptions=True) as client:
        yield client, index


def login(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": "testing123"})
    assert response.status_code == 200


def assert_private_absent(value):
    text = json.dumps(value, ensure_ascii=False)
    for secret in ("保密题名乙", "独有保密片段乙", '"opponent"', "未归属暗码丙", "未归属旧材料"):
        assert secret not in text


def test_owner_public_and_unassigned_materials(secured, monkeypatch):
    client, _ = secured
    login(client, "applicant")
    listed = client.get("/api/documents").json()["documents"]
    ids = {doc["id"] for doc in listed}
    assert {"own", "public-policy"} <= ids
    assert not ids & {"opponent", "legacy"}
    assert client.get("/api/documents/own/content").status_code == 200
    own_review = client.post("/api/review", json={"doc_id": "own"})
    assert own_review.status_code == 200
    assert_private_absent(own_review.json())
    assert client.post("/api/review", json={"doc_id": "public-policy"}).status_code == 403
    for doc_id in ("opponent", "legacy", "does-not-exist"):
        response = client.get(f"/api/documents/{doc_id}/content")
        assert response.status_code == 403
        assert response.json() == {"detail": "未找到该材料或无权读取"}
    assert client.get("/api/documents/own/access").status_code == 403
    assert client.put("/api/documents/own/access", json={"visibility": "public"}).status_code == 403
    # 非业务PermissionError仍走脱敏500，不能被阅读拒绝处理器回显服务器路径。
    def forbidden_stats():
        raise PermissionError("/private/internal/material-path")
    monkeypatch.setattr(db, "stats", forbidden_stats)
    with TestClient(application.app, raise_server_exceptions=False) as failing_client:
        failed = failing_client.get("/api/health")
        assert failed.status_code == 500
        assert failed.json() == {"error": "服务器内部错误"}
        assert "/private/internal" not in failed.text


def test_owner_duplicate_check_is_independent_and_anonymous(secured, monkeypatch):
    client, _ = secured
    def forbidden_matching(*_args, **_kwargs):
        raise AssertionError("独立查重不得运行专家匹配")
    monkeypatch.setattr(experts, "match_experts", forbidden_matching)
    login(client, "applicant")
    response = client.post("/api/duplicate/check", json={"doc_id": "own"})
    assert response.status_code == 200
    result = response.json()
    assert set(result) == {"doc", "duplicate", "generated_at", "disclaimer"}
    assert result["doc"]["id"] == "own"
    assert "相似度不等于抄袭" in result["disclaimer"] and "人工复核" in result["disclaimer"]
    assert "专家" not in json.dumps(result, ensure_ascii=False)
    assert_private_absent(result)
    matches = result["duplicate"]["matches"]
    assert matches and any(match.get("restricted") and match["source_snippet"] and match["similarity"] > 0 for match in matches)
    assert all(match["matched_doc_id"] == "" and match["matched_snippet"] == "" for match in matches if match.get("restricted"))
    assert client.post("/api/tool/check", json={"doc_id": "own"}).status_code == 403
    assert client.get("/api/experts").status_code == 403
    for doc_id in ("opponent", "public-policy", "legacy", "missing"):
        assert client.post("/api/duplicate/check", json={"doc_id": doc_id}).status_code == 403
    document_access.set_policy("opponent", "manager", "outsider", "public", [])
    assert client.post("/api/duplicate/check", json={"doc_id": "opponent"}).status_code == 403
    document_access.set_policy("opponent", "manager", "outsider", "restricted", ["applicant"])
    assert client.get("/api/documents/opponent/content").status_code == 200
    assert client.post("/api/duplicate/check", json={"doc_id": "opponent"}).status_code == 403


def test_duplicate_check_validates_body_and_keeps_management_roles(secured):
    client, _ = secured
    assert auth.create_user("admin", "testing123", "admin")
    document_access.set_policy("own", "manager", "applicant", "restricted", ["expert"])
    for username in ("manager", "admin", "expert"):
        login(client, username)
        result = client.post("/api/duplicate/check", json={"doc_id": "own"})
        assert result.status_code == 200
        assert "match" not in result.json()
    login(client, "manager")
    for doc_id in ("", "public-policy"):
        assert client.post("/api/duplicate/check", json={"doc_id": doc_id}).status_code == 400
    db.insert_document({"id": "empty-own", "name": "空申报材料", "kind": "other", "path": "/tmp/empty.txt", "owner_username": "applicant"}, [])
    login(client, "applicant")
    assert client.post("/api/duplicate/check", json={"doc_id": "empty-own"}).status_code == 400
    with db.connect() as conn:
        read_events = [dict(row) for row in conn.execute("SELECT doc_id, detail_json FROM document_access_events WHERE actor = 'manager' AND action = 'read'").fetchall()]
    assert any(row["doc_id"] == "own" and json.loads(row["detail_json"])["channel"] == "duplicate-check" for row in read_events)
    assert any(row["doc_id"] == "opponent" and json.loads(row["detail_json"])["channel"] == "duplicate-evidence" for row in read_events)


def test_upload_defaults_to_restricted_owner_even_for_policy_kind(secured, tmp_path, monkeypatch):
    client, _ = secured
    monkeypatch.setattr(application.config, "UPLOAD_DIR", tmp_path / "uploads")
    application.config.UPLOAD_DIR.mkdir()
    login(client, "manager")
    response = client.post("/api/documents", files={"file": ("上传政策.txt", "这是只供管理人员核验的上传材料。".encode(), "text/plain")}, data={"kind": "policy"})
    assert response.status_code == 200
    doc_id = response.json()["document"]["id"]
    policy = client.get(f"/api/documents/{doc_id}/access").json()["access"]
    assert policy == {"owner_username": "manager", "visibility": "restricted", "readers": []}
    login(client, "applicant")
    assert client.post("/api/documents", files={"file": ("拒绝上传.txt", b"blocked", "text/plain")}).status_code == 403
    assert client.get(f"/api/documents/{doc_id}/content").status_code == 403
    assert doc_id not in {doc["id"] for doc in client.get("/api/documents").json()["documents"]}


@pytest.mark.parametrize("endpoint", ["/api/chat", "/api/chat/stream"])
def test_chat_cannot_retrieve_protected_sources(secured, endpoint):
    client, _ = secured
    login(client, "applicant")
    denied = client.post(endpoint, json={"question": "研究内容是什么", "scope": ["opponent"]})
    assert denied.status_code == 403
    result = client.post(endpoint, json={"question": "科研诚信与自然资源数据治理", "scope": []})
    assert result.status_code == 200
    assert_private_absent(result.text)
    graph = client.get("/api/knowledge/keywords").json()
    assert_private_absent(graph)


def test_empty_scope_is_never_whole_library(secured):
    _, index = secured
    assert index.search("自然资源", scope=[] ) == []
    assert index.search("自然资源", scope=None)
    access = document_access.Access({"username": "missing-account", "role": "viewer"})
    # 显式收紧公开材料后，无授权账号的有效范围必须确实为空。
    for doc_id in access.readable:
        document_access.set_policy(doc_id, "manager", "", "restricted", [])
    access = document_access.Access({"username": "missing-account", "role": "viewer"})
    assert access.scope(None) == []
    assert qa.prepare("自然资源", scope=access.scope(None))["citations"] == []


def test_grant_revoke_and_audit_are_server_enforced(secured):
    client, _ = secured
    login(client, "manager")
    original = client.get("/api/documents/opponent/access").json()["access"]
    assert client.put("/api/documents/opponent/access", json={**original, "readers": ["unknown-account"]}).status_code == 400
    assert client.get("/api/documents/opponent/access").json()["access"] == original
    assert client.put("/api/documents/opponent/access", json={**original, "readers": ["expert"]}).status_code == 200
    login(client, "expert")
    assert client.get("/api/documents/opponent/content").status_code == 200
    login(client, "manager")
    events = client.get("/api/documents/opponent/access").json()["events"]
    assert any(event["actor"] == "expert" and event["action"] == "read" for event in events)
    assert client.put("/api/documents/opponent/access", json=original).status_code == 200
    login(client, "expert")
    assert client.get("/api/documents/opponent/content").status_code == 403
    assert "opponent" not in {doc["id"] for doc in client.get("/api/documents").json()["documents"]}


def make_case(client):
    login(client, "manager")
    expert_id = db.insert_expert({"name": "合成审核专家", "institution": "独立测试单位", "available": 1})
    review_cases.bind_expert_account("expert", expert_id, "manager")
    created = client.post("/api/review-cases", json={"doc_id": "own", "title": "权限隔离评审"})
    assert created.status_code == 200
    case_id = created.json()["case"]["id"]
    run = client.post(f"/api/review-cases/{case_id}/run")
    assert run.status_code == 200
    assigned = client.post(f"/api/review-cases/{case_id}/experts", json={"assignments": [{"expert_id": expert_id, "username": "expert"}]})
    assert assigned.status_code == 200, assigned.text
    return case_id, assigned.json()["case"]["tasks"][0]["id"]


def test_reviewer_checks_own_source_but_not_opponent_across_every_output(secured):
    client, _ = secured
    login(client, "expert")
    assert client.post("/api/tool/check", json={"doc_id": "own"}).status_code == 403
    case_id, task_id = make_case(client)
    login(client, "expert")
    assert client.get("/api/documents/own/content").status_code == 200
    assert client.get("/api/documents/opponent/content").status_code == 403
    for endpoint in ("/api/tool/check", "/api/review"):
        result = client.post(endpoint, json={"doc_id": "own"})
        assert result.status_code == 200
        body = result.json()
        assert_private_absent(body)
        restricted = [m for m in body["duplicate"]["matches"] if m.get("restricted")]
        assert restricted and restricted[0]["source_snippet"] and restricted[0]["similarity"] > 0
        assert restricted[0]["matched_doc_id"] == ""
    for endpoint in (f"/api/review-cases/{case_id}", f"/api/review-tasks/{task_id}", "/api/review-artifacts"):
        result = client.get(endpoint)
        assert result.status_code == 200
        assert_private_absent(result.json())
    for artifact in client.get("/api/review-artifacts").json()["artifacts"]:
        assert_private_absent(client.get(f"/api/review-artifacts/{artifact['id']}").json())


@pytest.mark.parametrize("legacy_kind", ["old-version", "missing-sources"])
def test_legacy_archive_projection_preserves_original_signature(secured, legacy_kind):
    client, _ = secured
    case_id, _ = make_case(client)
    with db.connect() as conn:
        original = dict(conn.execute("SELECT * FROM review_artifacts WHERE case_id = ? AND artifact_type = 'pre_review'", (case_id,)).fetchone())
        payload = json.loads(original["payload_json"])
        payload.pop("privacy_version" if legacy_kind == "old-version" else "narrative_source_ids")
        payload["mode"] = "qwen"
        payload["overall"]["summary"] = "历史模型转述：独有保密片段乙"
        content = "旧版原始正文：独有保密片段乙"
        digest = hashlib.sha256(content.encode()).hexdigest()
        conn.execute("UPDATE review_artifacts SET content = ?, sha256 = ?, payload_json = ? WHERE id = ?",
                     (content, digest, json.dumps(payload, ensure_ascii=False), original["id"]))
    login(client, "expert")
    response = client.get(f"/api/review-artifacts/{original['id']}").json()["artifact"]
    assert_private_absent(response)
    assert response["redacted"] is True and response["original_sha256"] == digest
    assert response["sha256"] == hashlib.sha256(response["content"].encode()).hexdigest()
    login(client, "manager")
    full = client.get(f"/api/review-artifacts/{original['id']}").json()["artifact"]
    assert full["content"] == content and full["sha256"] == digest
    db.init_db()
    assert client.get(f"/api/review-artifacts/{original['id']}").json()["artifact"]["content"] == content


def test_model_prompt_does_not_receive_other_projects_names_or_private_policy(secured, monkeypatch):
    _, _index = secured
    sent = []
    def capture(messages, **kwargs):
        sent.extend(messages)
        return "{}"
    monkeypatch.setattr(review.llm, "configured", True)
    monkeypatch.setattr(review.llm, "chat", capture)
    document_access.set_policy("public-policy", "manager", "outsider", "restricted", [])
    review.review_document("own")
    assert sent
    assert_private_absent(sent)
    assert "科研诚信公开政策规定" not in json.dumps(sent, ensure_ascii=False)


def test_vector_scores_cannot_escape_authorized_scope(secured, monkeypatch):
    _, index = secured
    # 即使后端忽略范围并把全部来源打成高分，统一检索层仍必须拦住。
    monkeypatch.setattr(type(index), "uses_embedding", property(lambda self: True))
    monkeypatch.setattr(index, "_score_embedding", lambda *_: np.ones(len(index.chunks)))
    hits = index.search("自然资源", scope=["own"])
    assert hits and {hit["doc_id"] for hit in hits} == {"own"}
    assert index.search("自然资源", scope=[]) == []


def test_revoked_model_policy_is_removed_from_every_narrative_and_archive(secured, monkeypatch):
    client, index = secured
    secret = "原公开政策的独有条款XYZ"
    monkeypatch.setattr(index, "search", lambda *_args, **_kwargs: [{"doc_id": "public-policy", "doc_name": "公开政策", "text": secret, "section": "第一条", "score": 1.0}])
    monkeypatch.setattr(review.llm, "configured", True)
    monkeypatch.setattr(review.llm, "chat", lambda *_args, **_kwargs: json.dumps({
        "summary": secret, "risk_level": "低", "questions": [secret],
        "sections": [{"key": "integrity", "title": secret, "status": "warn", "items": [{"label": secret, "detail": secret, "evidence": secret}]}],
    }))
    case_id, _ = make_case(client)
    original = next(a for a in client.get(f"/api/review-cases/{case_id}").json()["case"]["artifacts"] if a["artifact_type"] == "pre_review")
    original = client.get(f"/api/review-artifacts/{original['id']}").json()["artifact"]
    assert original["payload"]["mode"] == "qwen"
    assert original["payload"]["narrative_source_ids"] == ["public-policy"]
    login(client, "expert")
    shared = client.get(f"/api/review-artifacts/{original['id']}").json()["artifact"]
    assert shared["payload"]["overall"]["summary"].startswith(secret)
    assert "narrative_source_ids" not in shared["payload"]
    login(client, "manager")
    assert client.put("/api/documents/public-policy/access", json={"visibility": "restricted", "owner_username": "outsider"}).status_code == 200
    login(client, "expert")
    restricted = client.get(f"/api/review-artifacts/{original['id']}").json()["artifact"]
    assert secret not in json.dumps(restricted, ensure_ascii=False)
    assert "public-policy" not in json.dumps(restricted, ensure_ascii=False)
    assert restricted["payload"]["scoring"] == original["payload"]["scoring"]
    assert_private_absent(restricted["payload"]["scoring"])
    assert "precheck-v1" in restricted["content"]
    assert restricted["redacted"] is True
    assert restricted["original_sha256"] == original["sha256"]
    assert restricted["sha256"] == hashlib.sha256(restricted["content"].encode()).hexdigest()
    login(client, "manager")
    assert client.get(f"/api/review-artifacts/{original['id']}").json()["artifact"] == original


def test_read_audit_covers_graph_dossier_trend_and_precheck_evidence(secured):
    client, _ = secured
    dossier = db.insert_dossier({"name": "合成材料归集"})
    db.attach_dossier_document(dossier["id"], "own", "proposal_text")
    for doc_id, title in [("own", "可读科研诚信文献"), ("opponent", "隐藏科研诚信文献")]:
        db.insert_paper({"doc_id": doc_id, "title": title, "year": 2026, "abstract": "科研诚信自然资源数据治理", "keywords": "科研诚信"})
    login(client, "applicant")
    graph = client.get("/api/knowledge/keywords").json()
    assert any(source["doc_id"] == "own" for node in graph["nodes"] for source in node["sources"])
    assert client.get(f"/api/dossiers/{dossier['id']}/checklist").status_code == 200
    papers = client.get("/api/papers").json()["papers"]
    assert {paper["title"] for paper in papers} == {"可读科研诚信文献"}
    trend = client.post("/api/trends", json={"query": "科研诚信", "start_year": 2026, "end_year": 2026}).json()
    assert {paper["title"] for paper in trend["papers"]} == {"可读科研诚信文献"}
    assert "隐藏科研诚信文献" not in json.dumps(trend, ensure_ascii=False)
    document_access.set_policy("public-policy", "manager", "applicant", "restricted", [])
    access = document_access.Access({"username": "applicant", "role": "viewer"})
    evidence = {"mode": "offline", "privacy_version": 1, "duplicate": {"matches": [{"matched_doc_id": "public-policy"}]},
                "sections": [{"key": "policy", "items": [{"source_doc_id": "public-policy"}, {"source_doc_id": "public-policy"}]}]}
    access.report(evidence)
    with db.connect() as conn:
        events = [dict(row) for row in conn.execute("SELECT doc_id, detail_json FROM document_access_events WHERE actor = ? AND action = 'read'", ("applicant",)).fetchall()]
    channels = [(event["doc_id"], json.loads(event["detail_json"])["channel"]) for event in events]
    for channel in ("keyword-evidence", "dossier-checklist", "paper-evidence", "trend-evidence"):
        assert channels.count(("own", channel)) == 1
    assert channels.count(("public-policy", "review-evidence")) == 1
    assert not any(doc_id == "opponent" for doc_id, _channel in channels)
    # 只剥离可读来源的内部快照，不应改正文签名或误显示受限副本标记。
    report = {"privacy_version": 1, "mode": "qwen", "narrative_source_ids": ["public-policy"],
              "overall": {"summary": "有权读取的模型摘要"}, "duplicate": {"matches": []}, "sections": []}
    original = {"artifact_type": "pre_review", "source_doc_id": "own", "payload": report, "content": "签名原文", "sha256": "original-hash"}
    readable = access.artifact(original)
    assert readable["content"] == original["content"] and readable["sha256"] == original["sha256"]
    assert "redacted" not in readable and "narrative_source_ids" not in readable["payload"]
