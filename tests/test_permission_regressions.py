import json

import pytest

from rag import db, document_access, review
from test_document_access import secured, login


def test_busy_states_block_both_check_endpoints_and_viewer_kind(secured):
    client, _ = secured
    login(client, "manager")
    for state in ("queued", "processing", "indexing"):
        with db.connect() as conn:
            conn.execute("UPDATE documents SET meta_json=? WHERE id='own'", (json.dumps({"quality": {"state": state}}),))
        assert client.post("/api/tool/check", json={"doc_id": "own"}).status_code == 403
        assert client.post("/api/duplicate/check", json={"doc_id": "own"}).status_code == 403
    with db.connect() as conn:
        conn.execute("UPDATE documents SET meta_json='{}' WHERE id='own'")
    document_access.set_policy("public-policy", "manager", "applicant", "restricted", [])
    login(client, "applicant")
    assert client.get("/api/documents/public-policy/content").status_code == 200
    assert client.post("/api/review", json={"doc_id": "public-policy"}).status_code == 403
    assert client.post("/api/review", json={"doc_id": "own"}).status_code == 200


def test_policy_scope_is_filtered_before_top_k(secured, monkeypatch):
    client, index = secured
    for i in range(4):
        db.insert_document({"id": f"private-policy-{i}", "name": "受限政策", "kind": "policy", "source": "upload", "path": "", "owner_username": "outsider"},
                           [{"idx": 0, "text": "科研诚信与自然资源管理政策规定" * 30}])
    index.rebuild()
    calls = []
    original = index.search
    def search(*args, **kwargs):
        calls.append(kwargs.get("scope"))
        return original(*args, **kwargs)
    monkeypatch.setattr(index, "search", search)
    login(client, "applicant")
    response = client.post("/api/review", json={"doc_id": "own"})
    assert response.status_code == 200
    assert calls and "public-policy" in calls[0]
    assert not any(f"private-policy-{i}" in calls[0] for i in range(4))
    assert "private-policy-" not in response.text
    policy = next(section for section in response.json()["sections"] if section["key"] == "policy")
    assert any(item.get("source_doc_id") == "public-policy" for item in policy["items"])


def test_readable_papers_are_filtered_before_limit(secured):
    client, _ = secured
    with db.connect() as conn:
        conn.executemany("INSERT INTO papers (doc_id,title,year,created_at) VALUES (?,?,?,?)",
                         [("opponent", f"受限{i}", 2030, db.now()) for i in range(500)] +
                         [("public-policy", "可读文献", 2020, db.now())])
    login(client, "applicant")
    result = client.get("/api/papers").json()
    assert result["count"] == 1 and result["papers"][0]["title"] == "可读文献"
    assert "受限" not in json.dumps(result, ensure_ascii=False)


def test_unreadable_dossier_material_is_not_missing_or_disclosed(secured):
    client, _ = secured
    login(client, "manager")
    created = client.post("/api/dossiers", json={"name": "测试卷宗", "year": 2025, "plan_type": "directive", "phase": "application"})
    assert created.status_code == 200
    dossier_id = created.json()["dossier"]["id"]
    db.attach_dossier_document(dossier_id, "own", "proposal_text")
    with db.connect() as conn:
        conn.execute("UPDATE documents SET kind='other' WHERE id='opponent'")
    db.attach_dossier_document(dossier_id, "opponent", "integrity_pledge")
    db.update_dossier_document(dossier_id, "opponent", human_verified=True, verified_by="manager")
    login(client, "applicant")
    result = client.get(f"/api/dossiers/{dossier_id}/checklist")
    assert result.status_code == 200
    item = next(item for section in result.json()["sections"] for item in section["items"] if item["role"] == "integrity_pledge")
    assert item["status"] == "warn" and "无法" not in item["detail"] and "未能核验" in item["detail"]
    assert item["doc_id"] == "" and item["evidence"] == ""
    assert "opponent" not in result.text and "保密题名乙" not in result.text
