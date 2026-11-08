from pathlib import Path

import pytest

from rag import auth, db, review_cases


def _seed(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "review-cases.db")
    db.init_db()
    source = tmp_path / "proposal.txt"
    source.write_text("科研项目申报书", encoding="utf-8")
    db.insert_document(
        {
            "id": "doc-case",
            "name": "全过程评审测试项目",
            "kind": "proposal",
            "year": 2026,
            "source": "upload",
            "path": str(source),
            "text_len": 7,
            "status": "ready",
        },
        [{"idx": 0, "page": None, "section": "研究内容", "text": "科研项目申报书"}],
    )
    assert auth.create_user("manager-case", "manager123", "manager", "科研管理")
    assert auth.create_user("reviewer-case", "reviewer123", "reviewer", "审核专家")
    assert db.insert_expert_if_new(
        {
            "name": "测试专家",
            "institution": "测试大学",
            "title": "教授",
            "discipline": "自然资源",
            "research_areas": "遥感监测",
            "workload": 0,
            "available": 1,
            "source": "test",
        }
    )
    review_cases.bind_expert_account("reviewer-case", 1, "manager-case")


def _pre_payloads():
    report = {
        "doc": {"name": "全过程评审测试项目", "char_count": 7, "chunk_count": 1},
        "overall": {
            "risk_level": "中",
            "checked_items": 8,
            "generated_at": "2026-11-02T00:00:00",
            "summary": "预审摘要",
        },
        "sections": [{"title": "形式完整性", "items": [{"label": "研究内容", "detail": "已识别", "evidence": "原文"}]}],
        "disclaimer": "仅供人工复核。",
    }
    tool = {
        "doc": {"name": "全过程评审测试项目"},
        "duplicate": {"summary": "未发现高相似文档"},
        "match": {
            "summary": "已生成候选专家",
            "candidates": [{"expert": {"id": 1, "name": "测试专家", "institution": "测试大学", "title": "教授"}}],
        },
        "disclaimer": "仅提供候选。",
    }
    return report, tool


def test_review_case_full_lifecycle_and_artifacts(tmp_path, monkeypatch):
    _seed(tmp_path, monkeypatch)
    case = review_cases.create_case(
        title="全过程评审测试项目",
        doc_id="doc-case",
        dossier_id="",
        actor="manager-case",
    )
    assert case["stage"] == "pre_review"

    report, tool = _pre_payloads()
    report["limitations"] = ["离线能力边界测试"]
    report["sections"][0]["items"][0]["evidence_full"] = "完整政策条款测试"
    tool["duplicate"]["matches"] = [{"matched_doc_name": "其他材料", "similarity": 0.6, "source_snippet": "原文片段", "matched_snippet": "比对片段"}]
    tool["match"]["applicant_warning"] = "申报单位未识别"
    case = review_cases.save_pre_results(
        case["id"],
        actor="manager-case",
        report=report,
        tool_result=tool,
    )
    assert case["stage"] == "expert_review"
    pre = next(item for item in case["artifacts"] if item["artifact_type"] == "pre_review")
    check = next(item for item in case["artifacts"] if item["artifact_type"] == "tool_check")
    assert "离线能力边界测试" in pre["content"] and "完整政策条款测试" in pre["content"]
    assert "原文片段" in check["content"] and "比对片段" in check["content"] and "申报单位未识别" in check["content"]

    expert_id = db.list_experts()[0]["id"]
    case = review_cases.assign_tasks(
        case["id"],
        [{"expert_id": expert_id, "username": "reviewer-case"}],
        "manager-case",
    )
    assert case["task_total"] == 1
    with pytest.raises(ValueError, match="待审核任务"):
        review_cases.unbind_expert_account("reviewer-case", "manager-case")
    task_id = case["tasks"][0]["id"]

    reviewer = {"username": "reviewer-case", "role": "reviewer"}
    task = review_cases.get_task(task_id, reviewer)
    assert task["pre_review"]["artifact_type"] == "pre_review"
    admin_debug = {"username": "admin-debug", "role": "admin"}
    task = review_cases.get_task(task_id, admin_debug)
    assert task["assignee_username"] == "reviewer-case"
    case = review_cases.submit_task(
        task_id,
        admin_debug,
        recommendation="approve",
        opinion="项目材料完整，建议通过并补充年度监测计划。",
        conflict_declared=False,
        conflict_reason="",
    )
    assert case["tasks"][0]["status"] == "submitted"
    opinion_artifact = next(
        item for item in case["artifacts"] if item["artifact_type"] == "expert_opinion"
    )
    assert opinion_artifact["payload"]["admin_debug"] is True
    assert opinion_artifact["payload"]["assignee_username"] == "reviewer-case"

    case = review_cases.advance_to_final(case["id"], "manager-case")
    assert case["stage"] == "final_review"
    case = review_cases.finalize_case(
        case["id"],
        "manager-case",
        decision="approved",
        comment="专家意见已核对，同意通过并按要求补充材料。",
    )
    assert case["stage"] == "completed"
    assert case["final_decision"] == "approved"

    artifacts = review_cases.list_artifacts(
        {"username": "manager-case", "role": "manager"},
        case["id"],
    )
    assert {item["artifact_type"] for item in artifacts} == {
        "pre_review",
        "tool_check",
        "expert_assignment",
        "expert_opinion",
        "final_decision",
    }
    assert all(item["sha256"] for item in artifacts)
    final_artifact = next(item for item in artifacts if item["artifact_type"] == "final_decision")
    assert "管理员 admin-debug 代提交" in final_artifact["content"]
    assert "原指派账号 reviewer-case" in final_artifact["content"]
    review_cases.unbind_expert_account("reviewer-case", "manager-case")
    replacement = db.insert_expert({"name": "不能接管历史任务的专家", "institution": "测试机构"})
    with pytest.raises(ValueError, match="历史审核任务"):
        review_cases.bind_expert_account("reviewer-case", replacement, "manager-case")
    assert auth.create_user("reviewer-new", "reviewer123", "reviewer", "专家新账号")
    review_cases.bind_expert_account("reviewer-new", 1, "manager-case")
    with pytest.raises(PermissionError):
        review_cases.get_task(task_id, {"username": "reviewer-new", "role": "reviewer"})
    with db.connect() as conn:
        events = conn.execute("SELECT action FROM expert_account_history WHERE username = ? ORDER BY created_at, id", ("reviewer-case",)).fetchall()
    assert {event["action"] for event in events} == {"bound", "unbound"}
    assert len(case["actions"]) >= 5

    assert review_cases.get_task(task_id, reviewer)["case_status"] == "completed"
    assert review_cases.list_tasks(reviewer)[0]["case_status"] == "completed"
    assert review_cases.get_task(task_id, {"username": "manager-case", "role": "manager"})["case_status"] == "approved"
    reviewer_case = review_cases.get_case(case["id"], reviewer)
    assert len(reviewer_case["tasks"]) == 1
    assert reviewer_case["status"] == "completed"
    assert all(key not in reviewer_case for key in ("round", "flow_id", "previous_case_id"))
    assert all("round" not in item and "flow_id" not in item for item in reviewer_case["artifacts"])
    assert "round" not in review_cases.get_task(task_id, reviewer)
    visible_artifacts = review_cases.list_artifacts(reviewer)
    assert all("round" not in item and "flow_id" not in item for item in visible_artifacts)
    assert "round" not in review_cases.get_artifact(visible_artifacts[0]["id"], reviewer)
    assert "final_decision" not in reviewer_case
    assert "final_decision_label" not in reviewer_case
    assert "final_comment" not in reviewer_case
    reviewer_list = review_cases.list_cases(reviewer)
    assert reviewer_list
    reviewer_summary = next(item for item in reviewer_list if item["id"] == case["id"])
    assert reviewer_summary["status"] == "completed"
    assert all("final_decision" not in item and "final_comment" not in item for item in reviewer_list)
    assert {item["artifact_type"] for item in reviewer_case["artifacts"]} == {
        "pre_review",
        "tool_check",
        "expert_assignment",
        "expert_opinion",
    }

    with pytest.raises(ValueError, match="评审案卷"):
        db.delete_document("doc-case")


def test_review_case_expert_conflict_and_access_boundary(tmp_path, monkeypatch):
    _seed(tmp_path, monkeypatch)
    assert auth.create_user("other-reviewer", "reviewer123", "reviewer", "其他专家")
    case = review_cases.create_case(
        title="回避测试项目",
        doc_id="doc-case",
        dossier_id="",
        actor="manager-case",
    )
    report, tool = _pre_payloads()
    case = review_cases.save_pre_results(
        case["id"],
        actor="manager-case",
        report=report,
        tool_result=tool,
    )
    expert_id = db.list_experts()[0]["id"]
    with pytest.raises(ValueError, match="只能指派"):
        review_cases.assign_tasks(
            case["id"],
            [{"expert_id": expert_id + 999, "username": "reviewer-case"}],
            "manager-case",
        )
    with pytest.raises(ValueError, match="尚未一对一绑定"):
        review_cases.assign_tasks(
            case["id"],
            [{"expert_id": expert_id, "username": "other-reviewer"}],
            "manager-case",
        )
    case = review_cases.assign_tasks(
        case["id"],
        [{"expert_id": expert_id, "username": "reviewer-case"}],
        "manager-case",
    )
    task_id = case["tasks"][0]["id"]
    with pytest.raises(ValueError, match="均已指派"):
        review_cases.assign_tasks(
            case["id"],
            [{"expert_id": expert_id, "username": "reviewer-case"}],
            "manager-case",
        )

    assert review_cases.list_cases({"username": "other-reviewer", "role": "reviewer"}) == []
    with pytest.raises(PermissionError):
        review_cases.get_task(task_id, {"username": "other-reviewer", "role": "reviewer"})

    review_cases.submit_task(
        task_id,
        {"username": "reviewer-case", "role": "reviewer"},
        recommendation="approve",
        opinion="",
        conflict_declared=True,
        conflict_reason="专家本人参与申报项目，主动回避。",
    )
    with pytest.raises(ValueError, match="至少需要一份"):
        review_cases.advance_to_final(case["id"], "manager-case")


def test_concurrent_pre_review_only_archives_once(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    import threading

    _seed(tmp_path, monkeypatch)
    case = review_cases.create_case(title="并发预审", doc_id="doc-case", dossier_id="", actor="manager-case")
    report, tool = _pre_payloads()
    barrier = threading.Barrier(2)

    def run():
        barrier.wait(timeout=5)
        try:
            review_cases.save_pre_results(case["id"], actor="manager-case", report=report, tool_result=tool)
            return "success"
        except ValueError:
            return "rejected"

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: run(), range(2)))
    assert sorted(results) == ["rejected", "success"]
    result = review_cases.get_case(case["id"], {"username": "manager-case", "role": "manager"})
    assert len(result["artifacts"]) == 2


def test_concurrent_assignment_and_advance_cannot_leave_pending_final_task(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    import threading

    _seed(tmp_path, monkeypatch)
    second = db.insert_expert({"name": "第二位测试专家", "institution": "测试机构", "available": True})
    assert auth.create_user("reviewer-second", "reviewer123", "reviewer", "第二位专家")
    review_cases.bind_expert_account("reviewer-second", second, "manager-case")
    case = review_cases.create_case(title="并发阶段", doc_id="doc-case", dossier_id="", actor="manager-case")
    report, tool = _pre_payloads()
    tool["match"]["candidates"].append({"expert": {"id": second}})
    case = review_cases.save_pre_results(case["id"], actor="manager-case", report=report, tool_result=tool)
    case = review_cases.assign_tasks(case["id"], [{"expert_id": 1, "username": "reviewer-case"}], "manager-case")
    review_cases.submit_task(case["tasks"][0]["id"], {"username": "reviewer-case", "role": "reviewer"}, recommendation="approve", opinion="专家测试审核意见已经超过十个字", conflict_declared=False, conflict_reason="")
    barrier = threading.Barrier(2)

    def execute(action):
        barrier.wait(timeout=5)
        try:
            action()
            return "success"
        except ValueError:
            return "rejected"

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(execute, [
            lambda: review_cases.assign_tasks(case["id"], [{"expert_id": second, "username": "reviewer-second"}], "manager-case"),
            lambda: review_cases.advance_to_final(case["id"], "manager-case"),
        ]))
    assert sorted(results) == ["rejected", "success"]
    result = review_cases.get_case(case["id"], {"username": "manager-case", "role": "manager"})
    assert result["stage"] == "expert_review" or result["assigned_count"] == 0


def test_expert_account_binding_is_explicit_unique_and_idempotent(tmp_path, monkeypatch):
    _seed(tmp_path, monkeypatch)
    assert auth.create_user("reviewer-other", "reviewer123", "reviewer", "另一位专家")
    other_expert = db.insert_expert({"name": "另一位测试专家", "institution": "测试机构"})
    first = review_cases.bind_expert_account("reviewer-case", 1, "manager-case")
    assert review_cases.bind_expert_account("reviewer-case", 1, "manager-case") == first
    with pytest.raises(ValueError, match="已绑定"):
        review_cases.bind_expert_account("reviewer-other", 1, "manager-case")
    with pytest.raises(ValueError, match="已绑定"):
        review_cases.bind_expert_account("reviewer-case", other_expert, "manager-case")
    with pytest.raises(ValueError, match="评审专家角色"):
        review_cases.bind_expert_account("manager-case", other_expert, "manager-case")
    with pytest.raises(ValueError, match="专家不存在"):
        review_cases.bind_expert_account("reviewer-other", 999999, "manager-case")


def test_returned_case_creates_distinct_round_and_preserves_history(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    import threading

    _seed(tmp_path, monkeypatch)
    case = review_cases.create_case(title="重审测试", doc_id="doc-case", dossier_id="", actor="manager-case")
    with pytest.raises(ValueError, match="退回修改"):
        review_cases.create_resubmission(case["id"], "doc-case", "manager-case")
    report, tool = _pre_payloads()
    case = review_cases.save_pre_results(case["id"], actor="manager-case", report=report, tool_result=tool)
    case = review_cases.assign_tasks(case["id"], [{"expert_id": 1, "username": "reviewer-case"}], "manager-case")
    review_cases.submit_task(case["tasks"][0]["id"], {"username": "reviewer-case", "role": "reviewer"}, recommendation="revise", opinion="需要补充研究内容和完整的技术方案", conflict_declared=False, conflict_reason="")
    review_cases.advance_to_final(case["id"], "manager-case")
    previous = review_cases.finalize_case(case["id"], "manager-case", decision="returned", comment="请按照专家意见补充完整的申报材料")
    with pytest.raises(ValueError, match="不同于原材料"):
        review_cases.create_resubmission(case["id"], "doc-case", "manager-case")
    db.insert_document({"id": "doc-revised", "name": "补正版本", "kind": "proposal", "source": "test", "path": str(tmp_path / "revised.txt")}, [])
    barrier = threading.Barrier(2)

    def create_round():
        barrier.wait(timeout=5)
        try:
            return review_cases.create_resubmission(case["id"], "doc-revised", "manager-case")
        except ValueError as exc:
            return str(exc)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: create_round(), range(2)))
    created = [value for value in results if isinstance(value, dict)]
    assert len(created) == 1 and any(isinstance(value, str) and "已创建" in value for value in results)
    new_case = created[0]
    assert new_case["round"] == 2 and new_case["stage"] == "pre_review"
    assert new_case["doc_id"] == "doc-revised" and new_case["tasks"] == []
    assert new_case["flow_id"] == case["id"] and new_case["previous_case_id"] == case["id"]
    with pytest.raises(ValueError, match="已创建"):
        review_cases.create_resubmission(case["id"], "doc-revised", "manager-case")
    current_previous = review_cases.get_case(case["id"], {"username": "manager-case", "role": "manager"})
    assert current_previous["final_decision"] == "returned"
    assert [(x["id"], x["sha256"]) for x in current_previous["artifacts"]] == [(x["id"], x["sha256"]) for x in previous["artifacts"]]
    report, tool = _pre_payloads()
    new_case = review_cases.save_pre_results(new_case["id"], actor="manager-case", report=report, tool_result=tool)
    artifacts = review_cases.list_artifacts({"username": "manager-case", "role": "manager"})
    assert {a["round"] for a in artifacts if a["flow_id"] == case["id"]} == {1, 2}


def test_admin_conflict_submission_is_audited_in_final_archive(tmp_path, monkeypatch):
    _seed(tmp_path, monkeypatch)
    assert auth.create_user("reviewer-second", "reviewer123", "reviewer", "第二位专家")
    second = db.insert_expert({"name": "第二位测试专家", "institution": "第二测试机构"})
    review_cases.bind_expert_account("reviewer-second", second, "manager-case")
    case = review_cases.create_case(title="回避审计", doc_id="doc-case", dossier_id="", actor="manager-case")
    report, tool = _pre_payloads()
    tool["match"]["candidates"].append(
        {"expert": {"id": second, "name": "第二位测试专家", "institution": "第二测试机构", "title": ""}}
    )
    case = review_cases.save_pre_results(case["id"], actor="manager-case", report=report, tool_result=tool)
    case = review_cases.assign_tasks(
        case["id"],
        [
            {"expert_id": 1, "username": "reviewer-case"},
            {"expert_id": second, "username": "reviewer-second"},
        ],
        "manager-case",
    )
    conflict_task = next(task for task in case["tasks"] if task["expert_id"] == 1)
    opinion_task = next(task for task in case["tasks"] if task["expert_id"] == second)
    review_cases.submit_task(
        conflict_task["id"],
        {"username": "admin-debug", "role": "admin"},
        recommendation="approve",
        opinion="",
        conflict_declared=True,
        conflict_reason="管理员代录的回避原因",
    )
    review_cases.submit_task(
        opinion_task["id"],
        {"username": "reviewer-second", "role": "reviewer"},
        recommendation="approve",
        opinion="普通专家审核意见超过十个字并建议通过。",
        conflict_declared=False,
        conflict_reason="",
    )
    review_cases.advance_to_final(case["id"], "manager-case")
    final = review_cases.finalize_case(
        case["id"],
        "manager-case",
        decision="approved",
        comment="专家回避与意见均已核对，同意通过。",
    )
    artifact = next(item for item in final["artifacts"] if item["artifact_type"] == "final_decision")
    assert "管理员 admin-debug 代提交" in artifact["content"]
    assert "原指派账号 reviewer-case" in artifact["content"]
    audit = {entry["task_id"]: entry for entry in artifact["payload"]["task_audit"]}
    assert audit[conflict_task["id"]]["admin_debug"] is True
    assert audit[conflict_task["id"]]["submitted_by"] == "admin-debug"


def test_deleted_source_artifact_remains_readable_and_integrity_is_checked(tmp_path, monkeypatch):
    _seed(tmp_path, monkeypatch)
    db.insert_document(
        {"id": "attachment", "name": "附件快照", "kind": "other", "source": "test", "path": str(tmp_path / "attachment.txt")},
        [],
    )
    case = review_cases.create_case(title="来源删除", doc_id="doc-case", dossier_id="", actor="manager-case")
    with db.connect() as conn:
        artifact_id = review_cases._artifact(
            conn,
            case_id=case["id"],
            stage="pre_review",
            artifact_type="tool_check",
            title="附件归档",
            round_number=1,
            content="不可变归档正文",
            payload={},
            source_doc_id="attachment",
            actor="manager-case",
        )
    db.delete_document("attachment")
    listed = review_cases.list_artifacts({"username": "manager-case", "role": "manager"}, case["id"])
    artifact = next(item for item in listed if item["id"] == artifact_id)
    assert artifact["source_doc_missing"] is True
    assert artifact["source_doc_name"] == "附件快照"
    assert artifact["doc_name"] == "附件快照"
    assert artifact["integrity_status"] == "verified"

    with db.connect() as conn:
        conn.execute("UPDATE review_artifacts SET content='被篡改正文' WHERE id=?", (artifact_id,))
    changed = review_cases.get_artifact(artifact_id, {"username": "manager-case", "role": "manager"})
    assert changed["integrity_status"] == "mismatch"
    assert changed["integrity_verified"] is False


def test_reviewer_case_list_only_reports_own_task_and_visible_artifacts(tmp_path, monkeypatch):
    import json

    _seed(tmp_path, monkeypatch)
    assert auth.create_user("reviewer-second", "reviewer123", "reviewer", "第二位专家")
    second = db.insert_expert({"name": "第二位测试专家", "institution": "第二测试机构"})
    review_cases.bind_expert_account("reviewer-second", second, "manager-case")
    case = review_cases.create_case(title="列表脱敏", doc_id="doc-case", dossier_id="", actor="manager-case")
    report, tool = _pre_payloads()
    tool["match"]["candidates"].append(
        {"expert": {"id": second, "name": "第二位测试专家", "institution": "第二测试机构", "title": ""}}
    )
    case = review_cases.save_pre_results(case["id"], actor="manager-case", report=report, tool_result=tool)
    case = review_cases.assign_tasks(
        case["id"],
        [
            {"expert_id": 1, "username": "reviewer-case"},
            {"expert_id": second, "username": "reviewer-second"},
        ],
        "manager-case",
    )
    second_task = next(task for task in case["tasks"] if task["assignee_username"] == "reviewer-second")
    review_cases.submit_task(
        second_task["id"],
        {"username": "reviewer-second", "role": "reviewer"},
        recommendation="approve",
        opinion="第二位专家意见已经超过十个字。",
        conflict_declared=False,
        conflict_reason="",
    )
    summary = next(
        item for item in review_cases.list_cases({"username": "reviewer-case", "role": "reviewer"})
        if item["id"] == case["id"]
    )
    assert summary["task_total"] == 1
    assert summary["submitted_count"] == 0
    assert summary["updated_by"] == ""
    assert summary["artifact_count"] == 3
    assert "reviewer-second" not in json.dumps(summary, ensure_ascii=False)
