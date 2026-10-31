"""课题卷宗归卷、版本与材料体检规则。"""

import pytest

import app as app_module
from rag import auth, config
from rag import db, dossiers


def _setup(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "dossiers.db")
    db.init_db()


def _document(
    doc_id: str,
    name: str,
    text: str,
    suffix: str = ".docx",
    kind: str = "proposal",
) -> None:
    db.insert_document(
        {
            "id": doc_id,
            "name": name,
            "kind": kind,
            "year": 2026,
            "source": "upload",
            "path": f"/private/local/{doc_id}{suffix}",
        },
        [
            {
                "idx": 0,
                "page": 1,
                "section": "考核指标",
                "text": text,
            }
        ],
    )


def _dossier(plan_type: str = "directive", phase: str = "application") -> dict:
    return db.insert_dossier(
        {
            "name": "自然资源科研诚信课题",
            "year": 2026,
            "plan_type": plan_type,
            "phase": phase,
            "applicant_unit": "某自然资源研究院",
            "leader": "测试负责人",
            "supervisor": "某市自然资源主管部门",
        }
    )


def test_attach_same_role_creates_new_current_version(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier()
    _document("v1", "申请书第一版", "研究报告 论文 科技咨政报告")
    _document("v2", "申请书第二版", "研究报告 论文 科技咨政报告")

    first = db.attach_dossier_document(dossier["id"], "v1", "proposal_text")
    second = db.attach_dossier_document(dossier["id"], "v2", "proposal_text")
    materials = db.list_dossier_documents(dossier["id"])

    assert first["version"] == 1 and first["is_current"] is True
    assert second["version"] == 2 and second["is_current"] is True
    old = next(item for item in materials if item["doc_id"] == "v1")
    assert old["is_current"] is False
    assert {item["doc_id"] for item in materials} == {"v1", "v2"}


def test_attach_rejects_unknown_role_and_mismatched_document_kind(
    tmp_path, monkeypatch
):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier()
    _document("proposal", "申请书", "研究内容", kind="proposal")
    _document("pledge", "科研诚信承诺书", "承诺内容", kind="other")

    with pytest.raises(ValueError, match="材料角色无效"):
        db.attach_dossier_document(dossier["id"], "pledge", "typo_role")
    with pytest.raises(ValueError, match="文档类型与材料角色不匹配"):
        db.attach_dossier_document(
            dossier["id"], "proposal", "integrity_pledge"
        )
    attached = db.attach_dossier_document(
        dossier["id"], "pledge", "integrity_pledge"
    )
    assert attached["role"] == "integrity_pledge"


def test_switching_current_version_keeps_history(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier()
    _document("old", "旧版", "研究报告 论文")
    _document("new", "新版", "研究报告 论文")
    db.attach_dossier_document(dossier["id"], "old", "proposal_text")
    db.attach_dossier_document(dossier["id"], "new", "proposal_text")

    db.update_dossier_document(
        dossier["id"], "old", is_current=True, verified_by="manager"
    )
    materials = {
        item["doc_id"]: item for item in db.list_dossier_documents(dossier["id"])
    }
    assert materials["old"]["is_current"] is True
    assert materials["new"]["is_current"] is False


def test_removing_current_version_promotes_latest_remaining(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier()
    _document("v1", "第一版", "正文")
    _document("v2", "第二版", "正文")
    db.attach_dossier_document(dossier["id"], "v1", "proposal_text")
    db.attach_dossier_document(dossier["id"], "v2", "proposal_text")

    assert db.detach_dossier_document(dossier["id"], "v2") is True
    remaining = db.list_dossier_documents(dossier["id"])
    assert len(remaining) == 1
    assert remaining[0]["doc_id"] == "v1"
    assert remaining[0]["is_current"] is True


def test_human_verification_controls_scan_status(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier()
    _document("scan", "盖章申请书", "扫描件", suffix=".pdf")
    db.attach_dossier_document(dossier["id"], "scan", "signed_proposal")

    before = dossiers.checklist(dossier["id"])
    item = next(
        item
        for section in before["sections"]
        for item in section["items"]
        if item["role"] == "signed_proposal"
    )
    assert item["status"] == "warn"
    assert "尚未经人工确认" in item["detail"]

    db.update_dossier_document(
        dossier["id"], "scan", human_verified=True, verified_by="manager"
    )
    after = dossiers.checklist(dossier["id"])
    item = next(
        item
        for section in after["sections"]
        for item in section["items"]
        if item["role"] == "signed_proposal"
    )
    assert item["status"] == "pass"
    assert "完成人工确认" in item["detail"]


def test_signed_scan_warns_on_non_pdf_even_after_confirmation(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier()
    _document("scan", "盖章申请书", "文档正文", suffix=".docx")
    db.attach_dossier_document(dossier["id"], "scan", "signed_proposal")
    db.update_dossier_document(
        dossier["id"], "scan", human_verified=True, verified_by="manager"
    )

    result = dossiers.checklist(dossier["id"])
    item = next(
        item
        for section in result["sections"]
        for item in section["items"]
        if item["role"] == "signed_proposal"
    )
    assert item["status"] == "warn"
    assert "不是 PDF" in item["detail"]


def test_directive_plan_requires_advisory_report(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier(plan_type="directive")
    _document("proposal", "申请书", "考核指标：研究报告 1 份；论文 1 篇。")
    db.attach_dossier_document(dossier["id"], "proposal", "proposal_text")

    result = dossiers.checklist(dossier["id"])
    indicator = next(
        item
        for section in result["sections"]
        for item in section["items"]
        if item["key"] == "indicators"
    )
    assert indicator["status"] == "warn"
    assert "科技咨政报告" in indicator["detail"]


def test_guidance_plan_does_not_require_advisory_report(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier(plan_type="guidance")
    _document("proposal", "申请书", "考核指标：研究报告 1 份；论文 1 篇。")
    db.attach_dossier_document(dossier["id"], "proposal", "proposal_text")

    result = dossiers.checklist(dossier["id"])
    indicator = next(
        item
        for section in result["sections"]
        for item in section["items"]
        if item["key"] == "indicators"
    )
    assert indicator["status"] == "pass"
    assert "科技咨政报告" not in indicator["detail"]


def test_phase_selects_contract_or_implementation_commitment(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    directive = _dossier(plan_type="directive", phase="implementation")
    guidance = _dossier(plan_type="guidance", phase="implementation")

    directive_result = dossiers.checklist(directive["id"])
    guidance_result = dossiers.checklist(guidance["id"])

    directive_items = [
        item
        for section in directive_result["sections"]
        for item in section["items"]
    ]
    guidance_items = [
        item
        for section in guidance_result["sections"]
        for item in section["items"]
    ]
    assert any(item["role"] == "contract" for item in directive_items)
    assert not any(item["role"] == "implementation_commitment" for item in directive_items)
    assert any(item["role"] == "implementation_commitment" for item in guidance_items)
    assert not any(item["role"] == "contract" for item in guidance_items)


def test_material_response_hides_local_path(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier()
    _document("private", "本地材料", "正文", suffix=".pdf")
    db.attach_dossier_document(dossier["id"], "private", "signed_proposal")

    material = db.list_dossier_documents(dossier["id"])[0]
    assert material["doc_suffix"] == ".pdf"
    assert "path" not in material
    assert "/private/local" not in str(material)


def test_deleting_document_removes_dossier_association(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier()
    _document("doc", "待删文档", "正文")
    db.attach_dossier_document(dossier["id"], "doc", "other")

    db.delete_document("doc")
    assert db.list_dossier_documents(dossier["id"]) == []
    assert db.get_dossier(dossier["id"]) is not None


def test_deleting_dossier_keeps_document_and_removes_association(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    dossier = _dossier()
    _document("doc", "保留文档", "正文")
    db.attach_dossier_document(dossier["id"], "doc", "other")

    assert db.delete_dossier(dossier["id"]) is not None
    assert db.get_dossier(dossier["id"]) is None
    assert db.get_document("doc") is not None
    assert db.list_dossier_documents(dossier["id"]) == []


def test_invalid_plan_phase_and_role_are_rejected():
    dossiers.validate(
        {"plan_type": "directive", "phase": "application", "role": "proposal_text"}
    )
    dossiers.validate({"role": "signed_proposal"})
    with pytest.raises(ValueError, match="计划类型"):
        dossiers.validate({"plan_type": "unknown", "phase": "application"})
    with pytest.raises(ValueError, match="材料阶段"):
        dossiers.validate({"plan_type": "directive", "phase": "unknown"})
    with pytest.raises(ValueError, match="材料角色"):
        dossiers.validate(
            {"plan_type": "directive", "phase": "application", "role": "unknown"}
        )


def test_dossier_api_permissions_and_contract(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "SEED_DEMO_PAPERS", False)
    monkeypatch.setattr(config, "SEED_SAMPLE_DOC", False)
    monkeypatch.setattr(config, "SEED_DEMO_USERS", False)
    monkeypatch.setattr(app_module.retriever, "rebuild", lambda: None)
    auth.create_user("manager1", "secret1", "manager")
    auth.create_user("viewer1", "secret1", "viewer")

    from starlette.testclient import TestClient

    with TestClient(app_module.app) as client:
        assert client.post(
            "/api/auth/login",
            json={"username": "viewer1", "password": "secret1"},
        ).status_code == 200
        assert client.get("/api/dossiers/options").status_code == 200
        assert client.get("/api/dossiers").status_code == 200
        assert client.post(
            "/api/dossiers",
            json={
                "name": "无权限卷宗",
                "plan_type": "directive",
                "phase": "application",
            },
        ).status_code == 403
        client.post("/api/auth/logout")

        assert client.post(
            "/api/auth/login",
            json={"username": "manager1", "password": "secret1"},
        ).status_code == 200
        created = client.post(
            "/api/dossiers",
            json={
                "name": "接口卷宗",
                "year": 2026,
                "plan_type": "guidance",
                "phase": "application",
                "applicant_unit": "测试单位",
                "leader": "测试负责人",
                "supervisor": "测试主管部门",
            },
        )
        assert created.status_code == 200
        dossier_id = created.json()["dossier"]["id"]
        _document("graph-in", "卷内材料", "耕地监测 资源治理 生态评估")
        _document("graph-out", "卷外材料", "海岸侵蚀 潮汐观测 环境保护")
        _document("pledge-api", "科研诚信承诺书", "承诺内容", kind="other")
        db.attach_dossier_document(dossier_id, "graph-in", "proposal_text")
        graph = client.get("/api/knowledge/keywords", params={"limit": 20, "dossier_id": dossier_id})
        assert graph.status_code == 200 and graph.json()["limit"] == 20
        assert graph.json()["document_count"] == 1
        assert {source["doc_id"] for node in graph.json()["nodes"] for source in node["sources"]} == {"graph-in"}
        assert client.get("/api/knowledge/keywords", params={"dossier_id": "missing"}).status_code == 404
        assert client.get("/api/knowledge/keywords", params={"limit": 501}).status_code == 422
        assert client.get(f"/api/dossiers/{dossier_id}/checklist").status_code == 200
        assert client.patch(
            f"/api/dossiers/{dossier_id}",
            json={"name": None},
        ).status_code == 400
        assert client.post(
            f"/api/dossiers/{dossier_id}/documents",
            json={"doc_id": "pledge-api", "role": "typo_role"},
        ).status_code == 400
        assert client.post(
            f"/api/dossiers/{dossier_id}/documents",
            json={"doc_id": "graph-in", "role": "integrity_pledge"},
        ).status_code == 400
        assert client.post(
            f"/api/dossiers/{dossier_id}/documents",
            json={"doc_id": "pledge-api", "role": "integrity_pledge"},
        ).status_code == 200
        client.post("/api/auth/logout")
        assert client.post(
            "/api/auth/login",
            json={"username": "viewer1", "password": "secret1"},
        ).status_code == 200
        assert client.get("/api/dossiers").status_code == 200
        assert client.get(f"/api/dossiers/{dossier_id}").status_code == 200
        assert client.get(f"/api/dossiers/{dossier_id}/checklist").status_code == 200
        assert client.post(
            f"/api/dossiers/{dossier_id}/documents",
            json={"doc_id": "graph-out", "role": "other"},
        ).status_code == 403
