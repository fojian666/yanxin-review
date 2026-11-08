from types import SimpleNamespace
import hashlib
import json

import pytest
from starlette.testclient import TestClient

import app as application
from rag import auth, config, db, keyword_graph


@pytest.fixture
def audit_app(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "audit.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    config.UPLOAD_DIR.mkdir()
    monkeypatch.setattr(application, "seed_all", lambda: {})
    monkeypatch.setattr(application.retriever, "rebuild", lambda: None)
    monkeypatch.setattr(application, "retriever", SimpleNamespace(chunks=[], rebuild=lambda: None))
    db.init_db()
    assert auth.create_user("manager", "testing123", "manager")
    with TestClient(application.app, raise_server_exceptions=True) as client:
        assert client.post(
            "/api/auth/login",
            json={"username": "manager", "password": "testing123"},
        ).status_code == 200
        yield client


def _insert_document(doc_id: str, name: str = "材料") -> None:
    db.insert_document(
        {
            "id": doc_id,
            "name": name,
            "kind": "other",
            "path": f"/tmp/{doc_id}.txt",
            "source": "upload",
            "owner_username": "manager",
            "text_len": 12,
        },
        [{"idx": 0, "page": None, "section": "正文", "text": "科研诚信材料正文。"}],
    )


def test_upload_records_import_batch(audit_app):
    response = audit_app.post(
        "/api/documents",
        files={"file": ("批次材料.txt", "科研诚信材料正文。".encode(), "text/plain")},
        data={"kind": "other", "import_batch": "batch-20261108"},
    )
    assert response.status_code == 200
    doc_id = response.json()["document"]["id"]
    document = db.get_document(doc_id)
    assert document["meta"]["import_batch"] == "batch-20261108"
    assert document["meta"]["sha256"] == hashlib.sha256("科研诚信材料正文。".encode()).hexdigest()


def test_sample_documents_cannot_be_deleted_while_review_cases_reference_them(audit_app, monkeypatch):
    # 覆盖 API 的 409 行为；数据库层也拒绝，避免其他调用方绕过。
    from rag import seed

    monkeypatch.setattr(config, "SEED_DEMO_PROPOSALS", True)
    seed.seed_demo_proposals()
    demo_id = next(doc["id"] for doc in db.list_documents() if doc["source"] == "demo")
    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO review_cases
            (id, title, dossier_id, doc_id, stage, status, round, created_by,
             updated_by, created_at, updated_at, final_decision, final_comment)
            VALUES (?, ?, NULL, ?, 'pre_review', 'draft', 1, 'manager',
                    'manager', ?, ?, NULL, NULL)
            """,
            ("case-demo", "演示案卷", demo_id, db.now(), db.now()),
        )
    with pytest.raises(ValueError, match="仍关联演示本子"):
        db.delete_sample_documents()
    response = audit_app.delete("/api/documents/sample")
    assert response.status_code == 409
    assert "仍关联演示本子" in response.json()["detail"]
    assert db.get_document(demo_id) is not None


def test_sample_documents_cannot_be_deleted_while_dossiers_reference_them(audit_app, monkeypatch):
    from rag import seed

    monkeypatch.setattr(config, "SEED_DEMO_PROPOSALS", True)
    seed.seed_demo_proposals()
    demo_id = next(doc["id"] for doc in db.list_documents() if doc["source"] == "demo")
    dossier = db.insert_dossier({"name": "演示材料归卷", "year": 2026})
    db.attach_dossier_document(dossier["id"], demo_id, "proposal_text")

    with pytest.raises(ValueError, match="历史课题"):
        db.delete_sample_documents()
    response = audit_app.delete("/api/documents/sample")
    assert response.status_code == 409
    assert "历史课题" in response.json()["detail"]
    assert db.get_document(demo_id) is not None
    assert db.list_dossier_documents(dossier["id"])[0]["doc_id"] == demo_id


def test_dossier_and_keyword_scope_audit_every_disclosed_document(audit_app, monkeypatch):
    _insert_document("doc-a", "材料甲")
    _insert_document("doc-b", "材料乙")
    dossier = db.insert_dossier({"name": "审计卷宗", "year": 2026})
    db.attach_dossier_document(dossier["id"], "doc-a", "proposal_text")

    assert audit_app.get("/api/dossiers").status_code == 200
    monkeypatch.setattr(
        keyword_graph,
        "build_keyword_graph",
        lambda *_args, **_kwargs: {
            "nodes": [{"sources": [{"doc_id": "doc-a"}]}],
            "links": [],
        },
    )
    assert audit_app.get("/api/knowledge/keywords").status_code == 200

    with db.connect() as conn:
        rows = conn.execute(
            "SELECT doc_id, detail_json FROM document_access_events ORDER BY id"
        ).fetchall()
    events = [(row["doc_id"], json.loads(row["detail_json"])["channel"]) for row in rows]
    assert ("doc-a", "dossier-list") in events
    assert ("doc-a", "keyword-evidence") in events
    assert ("doc-b", "keyword-evidence") in events
