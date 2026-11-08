from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from . import auth, db

STAGES = {
    "pre_review": "预审",
    "expert_review": "专家审核",
    "final_review": "终审",
    "completed": "已归档",
}

TASK_STATUSES = {
    "assigned": "待审核",
    "submitted": "已提交",
    "conflict": "已回避",
}

ARTIFACT_TYPES = {
    "pre_review": "预审报告",
    "tool_check": "查重与专家匹配",
    "expert_assignment": "专家任务指派",
    "expert_opinion": "专家审核意见",
    "expert_conflict": "专家回避记录",
    "final_decision": "终审决定",
}

DECISIONS = {
    "approved": "通过",
    "returned": "退回修改",
    "deferred": "暂缓",
    "rejected": "不通过",
}

_RECOMMENDATIONS = {
    "approve": "建议通过",
    "revise": "建议修改",
    "reject": "建议不通过",
}


def _row(row) -> dict[str, Any] | None:
    if row is None:
        return None
    data = dict(row)
    for key in ("payload_json", "detail_json"):
        if key in data:
            raw = data.pop(key)
            try:
                data[key.removesuffix("_json")] = json.loads(raw) if raw else {}
            except (TypeError, json.JSONDecodeError):
                data[key.removesuffix("_json")] = {}
    if "conflict_declared" in data:
        data["conflict_declared"] = bool(data["conflict_declared"])
    if "stage" in data:
        data["stage_label"] = STAGES.get(data["stage"], data["stage"])
    if "status" in data and "assignee_username" in data:
        data["status_label"] = TASK_STATUSES.get(data["status"], data["status"])
    if data.get("recommendation"):
        data["recommendation_label"] = _RECOMMENDATIONS.get(data["recommendation"], data["recommendation"])
    if data.get("final_decision"):
        data["final_decision_label"] = DECISIONS.get(data["final_decision"], data["final_decision"])
    return data


def _inside(transaction, case_id: str, user: dict) -> bool:
    if user.get("role") in {"admin", "manager"}:
        return bool(transaction.execute("SELECT 1 FROM review_cases WHERE id = ?", (case_id,)).fetchone())
    if user.get("role") != "reviewer":
        return False
    return bool(
        transaction.execute(
            """
            SELECT 1 FROM review_cases c
            JOIN review_tasks t ON t.case_id = c.id
            WHERE c.id = ? AND t.assignee_username = ?
            """,
            (case_id, user.get("username", "")),
        ).fetchone()
    )


def _require_access(transaction, case_id: str, user: dict) -> None:
    if not _inside(transaction, case_id, user):
        raise PermissionError("无权访问该评审案卷")


def _artifact_visible(row, user: dict) -> bool:
    if user.get("role") != "reviewer":
        return True
    if row["artifact_type"] in {"pre_review", "tool_check"}:
        return True
    if row["created_by"] == user.get("username"):
        return True
    if row["artifact_type"] in {"expert_assignment", "expert_opinion", "expert_conflict"}:
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            return False
        return payload.get("assignee_username") == user.get("username")
    return False


def _artifact_row(row) -> dict[str, Any]:
    result = _row(row) or {}
    expected = str(result.get("sha256") or "")
    content = str(result.get("content") or "")
    actual = hashlib.sha256(content.encode("utf-8")).hexdigest()
    result["integrity_verified"] = bool(expected) and hmac.compare_digest(expected, actual)
    result["integrity_status"] = (
        "verified" if expected and result["integrity_verified"]
        else "mismatch" if expected
        else "unrecorded"
    )
    result["source_doc_missing"] = not bool(result.get("source_doc_id"))
    result["doc_name"] = result.get("doc_name") or result.get("source_doc_name") or "来源文档已删除或未记录"
    return result


def _action(transaction, case_id: str, actor: str, action: str, detail: dict | None = None, task_id: str | None = None) -> None:
    transaction.execute(
        """
        INSERT INTO review_actions (case_id, task_id, actor, action, detail_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            case_id,
            task_id,
            actor,
            action,
            json.dumps(detail or {}, ensure_ascii=False),
            db.now(),
        ),
    )


def _case_summary(row) -> dict[str, Any]:
    data = _row(row) or {}
    data["task_total"] = int(data.pop("task_total", 0) or 0)
    data["submitted_count"] = int(data.pop("submitted_count", 0) or 0)
    data["conflict_count"] = int(data.pop("conflict_count", 0) or 0)
    data["assigned_count"] = int(data.pop("assigned_count", 0) or 0)
    data["artifact_count"] = int(data.pop("artifact_count", 0) or 0)
    return data


def _decorate_task_audit(
    tasks: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> None:
    debug_by_task: dict[str, str] = {}
    for artifact in artifacts:
        payload = artifact.get("payload") or {}
        if payload.get("admin_debug") and payload.get("task_id"):
            debug_by_task[str(payload["task_id"])] = artifact.get("created_by", "")
    for task in tasks:
        submitter = debug_by_task.get(str(task.get("id") or ""), "")
        task["admin_debug"] = bool(submitter)
        task["submitted_by"] = submitter


def list_cases(user: dict) -> list[dict[str, Any]]:
    role = user.get("role")
    params: list[Any] = []
    where = ""
    task_join = ""
    if role == "reviewer":
        where = "WHERE EXISTS (SELECT 1 FROM review_tasks mine WHERE mine.case_id = c.id AND mine.assignee_username = ?)"
        task_join = "AND t.assignee_username = ?"
        params.extend([user.get("username", ""), user.get("username", "")])
    elif role not in {"admin", "manager"}:
        raise PermissionError("无权访问评审案卷")
    with db.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT c.*, COALESCE(r.root_case_id, c.id) AS flow_id, r.previous_case_id,
                   d.name AS doc_name, d.kind AS doc_kind,
                   COUNT(DISTINCT t.id) AS task_total,
                   SUM(CASE WHEN t.status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
                   SUM(CASE WHEN t.status = 'conflict' THEN 1 ELSE 0 END) AS conflict_count,
                   SUM(CASE WHEN t.status = 'assigned' THEN 1 ELSE 0 END) AS assigned_count,
                   (SELECT COUNT(*) FROM review_artifacts a WHERE a.case_id = c.id) AS artifact_count
            FROM review_cases c
            LEFT JOIN review_case_rounds r ON r.case_id = c.id
            JOIN documents d ON d.id = c.doc_id
            LEFT JOIN review_tasks t ON t.case_id = c.id {task_join}
            {where}
            GROUP BY c.id, r.root_case_id, r.previous_case_id, d.name, d.kind
            ORDER BY c.updated_at DESC, c.created_at DESC
            """,
            tuple(params),
        ).fetchall()
        visible_artifact_counts: dict[str, int] = {}
        if role == "reviewer" and rows:
            case_ids = [row["id"] for row in rows]
            artifact_rows = conn.execute(
                f"""
                SELECT case_id, artifact_type, created_by, payload_json
                FROM review_artifacts
                WHERE case_id IN ({','.join('?' for _ in case_ids)})
                """,
                tuple(case_ids),
            ).fetchall()
            for artifact in artifact_rows:
                if _artifact_visible(artifact, user):
                    visible_artifact_counts[artifact["case_id"]] = visible_artifact_counts.get(artifact["case_id"], 0) + 1
    result = [_case_summary(row) for row in rows]
    if role == "reviewer":
        for item in result:
            if item.get("stage") == "completed":
                item["status"] = "completed"
            item.pop("final_decision", None)
            item.pop("final_decision_label", None)
            item.pop("final_comment", None)
            item["artifact_count"] = visible_artifact_counts.get(str(item.get("id")), 0)
            item["updated_by"] = ""
            for key in ("round", "flow_id", "previous_case_id"):
                item.pop(key, None)
    return result


def create_case(
    *,
    title: str,
    doc_id: str,
    dossier_id: str,
    actor: str,
) -> dict[str, Any]:
    title = title.strip()
    doc = db.get_document(doc_id)
    if not doc:
        raise ValueError("申报文档不存在")
    if doc.get("kind") not in {"proposal", "other"}:
        raise ValueError("仅申报书或实际材料可建立评审案卷")
    if dossier_id:
        dossier = db.get_dossier(dossier_id)
        if not dossier:
            raise ValueError("历史课题不存在")
        materials = db.list_dossier_documents(dossier_id)
        if not any(item.get("doc_id") == doc_id for item in materials):
            raise ValueError("所选文档不属于该历史课题")
        title = title or dossier["name"]
    title = title or doc["name"]
    case_id = db.new_id()
    stamp = db.now()
    with db.connect() as conn:
        from .material_processing import _locked_document, BUSY
        material = _locked_document(conn, doc_id)
        if (json.loads(material.get("meta_json") or "{}").get("quality") or {}).get("state") in BUSY:
            raise ValueError("材料正在处理或更新索引，请完成后再建立评审案卷")
        conn.execute(
            """
            INSERT INTO review_cases
            (id, title, dossier_id, doc_id, stage, status, round, created_by,
             updated_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pre_review', 'draft', 1, ?, ?, ?, ?)
            """,
            (case_id, title, dossier_id or None, doc_id, actor, actor, stamp, stamp),
        )
        _action(conn, case_id, actor, "case_created", {"doc_id": doc_id, "dossier_id": dossier_id})
    return get_case(case_id, {"username": actor, "role": "admin"})


def get_case(case_id: str, user: dict) -> dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT c.*, COALESCE(r.root_case_id, c.id) AS flow_id, r.previous_case_id,
                   d.name AS doc_name, d.kind AS doc_kind, d.year AS doc_year,
                   d.text_len AS doc_text_len, d.chunk_count AS doc_chunk_count
            FROM review_cases c
            LEFT JOIN review_case_rounds r ON r.case_id = c.id
            JOIN documents d ON d.id = c.doc_id
            WHERE c.id = ?
            """,
            (case_id,),
        ).fetchone()
        if not row:
            raise ValueError("评审案卷不存在")
        if not _inside(conn, case_id, user):
            raise PermissionError("无权访问该评审案卷")
        if user.get("role") == "reviewer":
            tasks = conn.execute(
                """
                SELECT * FROM review_tasks
                WHERE case_id = ? AND assignee_username = ?
                ORDER BY created_at, id
                """,
                (case_id, user.get("username", "")),
            ).fetchall()
            artifacts = conn.execute(
                """
                SELECT * FROM review_artifacts
                WHERE case_id = ?
                ORDER BY created_at, id
                """,
                (case_id,),
            ).fetchall()
            artifacts = [artifact for artifact in artifacts if _artifact_visible(artifact, user)]
            actions = conn.execute(
                """
                SELECT * FROM review_actions
                WHERE case_id = ? AND actor = ?
                ORDER BY created_at, id
                """,
                (case_id, user.get("username", "")),
            ).fetchall()
        else:
            tasks = conn.execute(
                "SELECT * FROM review_tasks WHERE case_id = ? ORDER BY created_at, id",
                (case_id,),
            ).fetchall()
            artifacts = conn.execute(
                "SELECT * FROM review_artifacts WHERE case_id = ? ORDER BY created_at, id",
                (case_id,),
            ).fetchall()
            actions = conn.execute(
                "SELECT * FROM review_actions WHERE case_id = ? ORDER BY created_at, id",
                (case_id,),
            ).fetchall()
    data = _row(row) or {}
    if user.get("role") == "reviewer":
        if data.get("stage") == "completed":
            data["status"] = "completed"
        data.pop("final_decision", None)
        data.pop("final_decision_label", None)
        data.pop("final_comment", None)
        for key in ("round", "flow_id", "previous_case_id"):
            data.pop(key, None)
    data["tasks"] = [_row(task) for task in tasks]
    data["artifacts"] = [_artifact_row(artifact) for artifact in artifacts]
    if user.get("role") == "reviewer":
        for artifact in data["artifacts"]:
            artifact.pop("round", None)
            artifact.pop("flow_id", None)
    _decorate_task_audit(data["tasks"], data["artifacts"])
    data["actions"] = [_row(action) for action in actions]
    data["task_total"] = len(tasks)
    data["submitted_count"] = sum(task["status"] == "submitted" for task in tasks)
    data["conflict_count"] = sum(task["status"] == "conflict" for task in tasks)
    data["assigned_count"] = sum(task["status"] == "assigned" for task in tasks)
    data["artifact_count"] = len(artifacts)
    return data


def reviewer_options() -> list[dict[str, Any]]:
    with db.connect() as conn:
        bindings = {row["username"]: dict(row) for row in conn.execute("SELECT a.username, a.expert_id, e.name AS expert_name, e.institution AS expert_institution FROM expert_accounts a JOIN experts e ON e.id = a.expert_id").fetchall()}
    return [
        {
            "username": item["username"],
            "display_name": item.get("display_name") or item["username"],
            "expert_id": bindings.get(item["username"], {}).get("expert_id"),
            "expert_name": bindings.get(item["username"], {}).get("expert_name", ""),
            "expert_institution": bindings.get(item["username"], {}).get("expert_institution", ""),
        }
        for item in auth.list_users()
        if item.get("role") == "reviewer"
    ]


def bind_expert_account(username: str, expert_id: int, actor: str) -> dict[str, Any]:
    """Explicit, one-to-one binding; never infer identities from historical tasks."""
    username = username.strip()
    with db.connect() as conn:
        if db.backend() == "sqlite":
            conn.execute("BEGIN IMMEDIATE")
        suffix = " FOR UPDATE" if db.backend() == "postgresql" else ""
        user = conn.execute("SELECT role FROM users WHERE username = ?" + suffix, (username,)).fetchone()
        if not user or user["role"] != "reviewer":
            raise ValueError("审核账号必须是评审专家角色")
        expert = conn.execute("SELECT id, name, institution FROM experts WHERE id = ?", (expert_id,)).fetchone()
        if not expert:
            raise ValueError("专家不存在")
        if conn.execute(
            """SELECT 1 FROM review_tasks WHERE
               assignee_username = ? AND (expert_id IS NULL OR expert_id <> ?) LIMIT 1""",
            (username, expert_id),
        ).fetchone():
            raise ValueError("账号已有其他专家的历史审核任务，不能重新绑定")
        existing = conn.execute(
            "SELECT username, expert_id, bound_by, created_at FROM expert_accounts WHERE username = ? OR expert_id = ?",
            (username, expert_id),
        ).fetchone()
        if existing:
            if existing["username"] == username and existing["expert_id"] == expert_id:
                return dict(existing)
            raise ValueError("账号或专家已绑定其他身份")
        created_at = db.now()
        result = conn.execute(
            "INSERT INTO expert_accounts (username, expert_id, bound_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
            (username, expert_id, actor, created_at),
        )
        if not result.rowcount:
            raise ValueError("账号或专家已绑定其他身份，请刷新后重试")
        conn.execute(
            "INSERT INTO expert_account_history (id, username, expert_id, expert_name, expert_institution, action, actor, created_at) VALUES (?, ?, ?, ?, ?, 'bound', ?, ?)",
            (db.new_id(), username, expert_id, expert["name"], expert["institution"] or "", actor, created_at),
        )
    return {"username": username, "expert_id": expert_id, "bound_by": actor, "created_at": created_at}


def unbind_expert_account(username: str, actor: str) -> None:
    with db.connect() as conn:
        if db.backend() == "sqlite":
            conn.execute("BEGIN IMMEDIATE")
        suffix = " FOR UPDATE" if db.backend() == "postgresql" else ""
        conn.execute("SELECT username FROM users WHERE username = ?" + suffix, (username,)).fetchone()
        binding = conn.execute("SELECT expert_id FROM expert_accounts WHERE username = ?" + suffix, (username,)).fetchone()
        if not binding:
            raise ValueError("该账号未绑定专家")
        if conn.execute("SELECT 1 FROM review_tasks WHERE assignee_username = ? AND status = 'assigned' LIMIT 1", (username,)).fetchone():
            raise ValueError("该账号仍有待审核任务，不能解除绑定")
        expert = conn.execute("SELECT name, institution FROM experts WHERE id = ?", (binding["expert_id"],)).fetchone()
        conn.execute("DELETE FROM expert_accounts WHERE username = ?", (username,))
        conn.execute(
            "INSERT INTO expert_account_history (id, username, expert_id, expert_name, expert_institution, action, actor, created_at) VALUES (?, ?, ?, ?, ?, 'unbound', ?, ?)",
            (db.new_id(), username, binding["expert_id"], expert["name"], expert["institution"] or "", actor, db.now()),
        )


def _artifact(
    transaction,
    *,
    case_id: str,
    stage: str,
    artifact_type: str,
    title: str,
    round_number: int,
    content: str,
    payload: dict[str, Any],
    source_doc_id: str,
    actor: str,
) -> str:
    artifact_id = db.new_id()
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    source = transaction.execute(
        "SELECT name FROM documents WHERE id = ?", (source_doc_id,)
    ).fetchone()
    source_doc_name = source["name"] if source else ""
    transaction.execute(
        """
        INSERT INTO review_artifacts
        (id, case_id, stage, artifact_type, title, round, format, content,
         payload_json, source_doc_id, source_doc_name, created_by, created_at, sha256)
        VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            artifact_id,
            case_id,
            stage,
            artifact_type,
            title,
            round_number,
            content,
            json.dumps(payload, ensure_ascii=False),
            source_doc_id,
            source_doc_name,
            actor,
            db.now(),
            digest,
        ),
    )
    return artifact_id


def _review_markdown(report: dict[str, Any]) -> str:
    from .review_scoring import scoring_markdown

    overall = report.get("overall") or {}
    generation = report.get("generation") or {}
    if not generation:
        source = "来源未记录"
    elif generation.get("provider") == "offline":
        source = "离线规则" + ("（已回退）" if generation.get("status") == "fallback" else "")
    else:
        source = " · ".join(str(generation.get(key) or "") for key in ("label", "model")).strip(" ·") or "来源未记录"
    lines = [
        f"# 预审报告 · {report.get('doc', {}).get('name', '')}",
        "",
        f"- 风险等级：{overall.get('risk_level', '')}",
        f"- 检查项：{overall.get('checked_items', 0)}",
        f"- 生成时间：{overall.get('generated_at', '')}",
        f"- 生成来源：{source}",
        "",
        overall.get("summary", ""),
        "",
    ]
    lines.extend(scoring_markdown(report.get("scoring")))
    for section in report.get("sections") or []:
        lines.append(f"## {section.get('title', '')}")
        for item in section.get("items") or []:
            lines.append(f"- {item.get('label', '')}：{item.get('detail', '')}")
            evidence = item.get("evidence_full") or item.get("evidence")
            if evidence:
                lines.append(f"  - 依据：{evidence}")
        lines.append("")
    if report.get("warning"):
        lines.extend(["## 运行提示", report["warning"], ""])
    if report.get("limitations"):
        lines.extend(["## 能力边界", *(f"- {item}" for item in report["limitations"]), ""])
    if report.get("questions"):
        lines.extend(["## 待核实问题", *(f"- {item}" for item in report["questions"]), ""])
    if report.get("disclaimer"):
        lines.extend(["---", report["disclaimer"]])
    return "\n".join(lines)


def _tool_markdown(result: dict[str, Any]) -> str:
    duplicate = result.get("duplicate") or {}
    match = result.get("match") or {}
    lines = [
        f"# 查重与专家匹配 · {result.get('doc', {}).get('name', '')}",
        "",
        "## 文本查重",
        duplicate.get("summary", "未执行"),
    ]
    for item in duplicate.get("matches") or []:
        lines.extend([
            f"- 比对文档：{item.get('matched_doc_name', '')}；相似度：{item.get('similarity', '')}",
            f"  - 本文：{item.get('source_snippet', '')}",
            "  - 对方原文受保护，须经授权核验。" if item.get("restricted") else f"  - 比对：{item.get('matched_snippet', '')}",
        ])
    lines.extend(["", "## 专家匹配", match.get("summary", "未执行"), ""])
    for key in ("applicant_warning", "institution_match_note"):
        if match.get(key):
            lines.extend([match[key], ""])
    for candidate in match.get("candidates") or []:
        expert = candidate.get("expert") or {}
        lines.append(
            f"- {expert.get('name', '')}（{expert.get('institution', '')} / {expert.get('title', '')}）"
        )
    for item in match.get("excluded") or []:
        lines.append(f"- 已排除 {item.get('name', '')}（{item.get('institution', '')}）：{item.get('reason', '')}；{item.get('evidence', '')}")
    if result.get("disclaimer"):
        lines.extend(["", "---", result["disclaimer"]])
    return "\n".join(lines)


def _locked_case(conn, case_id: str):
    # Serialize task assignment and stage changes against the same case.
    if db.backend() == "postgresql":
        return conn.execute("SELECT * FROM review_cases WHERE id = ? FOR UPDATE", (case_id,)).fetchone()
    conn.execute("BEGIN IMMEDIATE")
    return conn.execute("SELECT * FROM review_cases WHERE id = ?", (case_id,)).fetchone()


def create_resubmission(case_id: str, doc_id: str, actor: str) -> dict[str, Any]:
    """Create a new case for the next round without changing the signed round."""
    with db.connect() as conn:
        previous = _locked_case(conn, case_id)
        if not previous:
            raise ValueError("评审案卷不存在")
        if previous["stage"] != "completed" or previous["final_decision"] != "returned":
            raise ValueError("仅已签署退回修改的案卷可以补正重审")
        if conn.execute("SELECT 1 FROM review_case_rounds WHERE previous_case_id = ?", (case_id,)).fetchone():
            raise ValueError("该轮次已创建补正重审案卷")
        suffix = " FOR UPDATE" if db.backend() == "postgresql" else ""
        doc = conn.execute("SELECT id, kind, meta_json FROM documents WHERE id = ?" + suffix, (doc_id,)).fetchone()
        if doc and (json.loads(doc["meta_json"] or "{}").get("quality") or {}).get("state") in {"queued", "processing", "indexing"}:
            raise ValueError("补正材料正在处理，请完成后再重新送审")
        if not doc or doc["kind"] not in {"proposal", "other"} or doc_id == previous["doc_id"]:
            raise ValueError("请选择不同于原材料的新申报书或项目材料")
        if previous["dossier_id"] and not conn.execute(
            "SELECT 1 FROM dossier_documents WHERE dossier_id = ? AND doc_id = ? AND is_current = 1",
            (previous["dossier_id"], doc_id),
        ).fetchone():
            raise ValueError("补正材料须先归入原历史课题并设为当前版本")
        previous_link = conn.execute("SELECT root_case_id FROM review_case_rounds WHERE case_id = ?", (case_id,)).fetchone()
        root_id = previous_link["root_case_id"] if previous_link else case_id
        if conn.execute(
            """SELECT 1 FROM review_cases c LEFT JOIN review_case_rounds r ON r.case_id = c.id
               WHERE COALESCE(r.root_case_id, c.id) = ? AND c.doc_id = ? LIMIT 1""",
            (root_id, doc_id),
        ).fetchone():
            raise ValueError("补正材料不能使用本流程之前评审过的版本")
        new_id = db.new_id()
        stamp = db.now()
        conn.execute(
            """INSERT INTO review_cases (id, title, dossier_id, doc_id, stage, status, round, created_by, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'pre_review', 'draft', ?, ?, ?, ?, ?)""",
            (new_id, previous["title"], previous["dossier_id"], doc_id, int(previous["round"]) + 1, actor, actor, stamp, stamp),
        )
        conn.execute("INSERT INTO review_case_rounds (case_id, root_case_id, previous_case_id) VALUES (?, ?, ?)", (new_id, root_id, case_id))
        _action(conn, case_id, actor, "resubmission_created", {"next_case_id": new_id, "doc_id": doc_id})
        _action(conn, new_id, actor, "resubmission_started", {"previous_case_id": case_id, "doc_id": doc_id})
    return get_case(new_id, {"username": actor, "role": "manager"})


def save_pre_results(
    case_id: str,
    *,
    actor: str,
    report: dict[str, Any],
    tool_result: dict[str, Any],
) -> dict[str, Any]:
    with db.connect() as conn:
        case = _locked_case(conn, case_id)
        if not case:
            raise ValueError("评审案卷不存在")
        if case["stage"] != "pre_review":
            raise ValueError("当前案卷已进入后续阶段，预审结果不能覆盖")
        pre_id = _artifact(
            conn,
            case_id=case_id,
            stage="pre_review",
            artifact_type="pre_review",
            title="预审报告",
            round_number=case["round"],
            content=_review_markdown(report),
            payload=report,
            source_doc_id=case["doc_id"],
            actor=actor,
        )
        tool_id = _artifact(
            conn,
            case_id=case_id,
            stage="pre_review",
            artifact_type="tool_check",
            title="查重与专家匹配",
            round_number=case["round"],
            content=_tool_markdown(tool_result),
            payload=tool_result,
            source_doc_id=case["doc_id"],
            actor=actor,
        )
        updated = conn.execute(
            """
            UPDATE review_cases
            SET stage = 'expert_review', status = 'in_progress',
                updated_by = ?, updated_at = ?
            WHERE id = ? AND stage = 'pre_review'
            """,
            (actor, db.now(), case_id),
        )
        if not updated.rowcount:
            raise ValueError("案卷已进入其他阶段，请刷新后重试")
        _action(
            conn,
            case_id,
            actor,
            "pre_review_completed",
            {"pre_review_artifact": pre_id, "tool_check_artifact": tool_id},
        )
    return get_case(case_id, {"username": actor, "role": "admin"})


def assign_tasks(
    case_id: str,
    assignments: list[dict[str, Any]],
    actor: str,
) -> dict[str, Any]:
    if not assignments:
        raise ValueError("请至少指派一位专家")
    with db.connect() as conn:
        case = _locked_case(conn, case_id)
        if not case:
            raise ValueError("评审案卷不存在")
        if case["stage"] != "expert_review":
            raise ValueError("案卷尚未完成预审或已进入终审")
        tool_artifact = conn.execute(
            """
            SELECT payload_json FROM review_artifacts
            WHERE case_id = ? AND artifact_type = 'tool_check'
            ORDER BY created_at DESC, id DESC LIMIT 1
            """,
            (case_id,),
        ).fetchone()
        if not tool_artifact:
            raise ValueError("案卷缺少专家匹配结果，请先完成预审")
        try:
            tool_payload = json.loads(tool_artifact["payload_json"] or "{}")
        except json.JSONDecodeError as exc:
            raise ValueError("专家匹配归档损坏，请重新建立案卷") from exc
        allowed_experts = {
            int(candidate["expert"]["id"])
            for candidate in tool_payload.get("match", {}).get("candidates", [])
            if candidate.get("expert", {}).get("id")
        }
        created = 0
        stamp = db.now()
        for item in sorted(assignments, key=lambda value: str(value.get("username", "")).strip()):
            username = str(item.get("username", "")).strip()
            expert_id = int(item.get("expert_id") or 0)
            user = conn.execute("SELECT role FROM users WHERE username = ?", (username,)).fetchone()
            if not user or user["role"] != "reviewer":
                raise ValueError("审核账号必须是评审专家角色")
            if expert_id not in allowed_experts:
                raise ValueError("只能指派通过回避、负载和可用性过滤的候选专家")
            binding_sql = "SELECT expert_id FROM expert_accounts WHERE username = ?"
            if db.backend() == "postgresql":
                binding_sql += " FOR UPDATE"
            binding = conn.execute(binding_sql, (username,)).fetchone()
            if not binding or binding["expert_id"] != expert_id:
                raise ValueError("审核账号与候选专家尚未一对一绑定")
            expert = conn.execute(
                "SELECT id, name, institution, title FROM experts WHERE id = ?",
                (expert_id,),
            ).fetchone()
            if not expert:
                raise ValueError("候选专家不存在")
            exists = conn.execute(
                """
                SELECT 1 FROM review_tasks
                WHERE case_id = ? AND expert_id = ?
                """,
                (case_id, expert_id),
            ).fetchone()
            if exists:
                continue
            task_id = db.new_id()
            inserted = conn.execute(
                """
                INSERT INTO review_tasks
                (id, case_id, assignee_username, expert_id, expert_name,
                 expert_institution, expert_title, status, conflict_declared,
                 conflict_reason, recommendation, opinion, submitted_at,
                 created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'assigned', 0, '', NULL, NULL, NULL, ?, ?)
                ON CONFLICT DO NOTHING
                """,
                (
                    task_id,
                    case_id,
                    username,
                    expert["id"],
                    expert["name"],
                    expert["institution"] or "",
                    expert["title"] or "",
                    stamp,
                    stamp,
                ),
            )
            if not inserted.rowcount:
                continue
            stamp_text = stamp
            artifact_id = _artifact(
                conn,
                case_id=case_id,
                stage="expert_review",
                artifact_type="expert_assignment",
                title=f"{expert['name']} · 专家任务指派",
                round_number=case["round"],
                content=(
                    f"# 专家审核任务指派\n\n"
                    f"- 案卷：{case['title']}\n"
                    f"- 专家：{expert['name']}（{expert['institution'] or ''} / {expert['title'] or ''}）\n"
                    f"- 审核账号：{username}\n"
                    f"- 指派账号：{actor}\n"
                    f"- 指派时间：{stamp_text}\n"
                ),
                payload={
                    "task_id": task_id,
                    "expert_id": expert_id,
                    "expert_name": expert["name"],
                    "assignee_username": username,
                },
                source_doc_id=case["doc_id"],
                actor=actor,
            )
            _action(
                conn,
                case_id,
                actor,
                "expert_assigned",
                {"expert_id": expert_id, "expert_name": expert["name"], "artifact_id": artifact_id},
                task_id=task_id,
            )
            created += 1
        if not created:
            raise ValueError("所选专家均已指派")
        conn.execute(
            "UPDATE review_cases SET updated_by = ?, updated_at = ? WHERE id = ?",
            (actor, stamp, case_id),
        )
    return get_case(case_id, {"username": actor, "role": "admin"})


def list_tasks(user: dict, case_id: str | None = None) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if user.get("role") == "reviewer":
        clauses.append("t.assignee_username = ?")
        params.append(user.get("username", ""))
    elif user.get("role") not in {"admin", "manager"}:
        raise PermissionError("无权访问专家任务")
    if case_id:
        clauses.append("t.case_id = ?")
        params.append(case_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with db.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT t.*, c.title AS case_title, c.stage AS case_stage,
                   c.status AS case_status, c.doc_id, d.name AS doc_name
            FROM review_tasks t
            JOIN review_cases c ON c.id = t.case_id
            JOIN documents d ON d.id = c.doc_id
            {where}
            ORDER BY CASE t.status WHEN 'assigned' THEN 0 WHEN 'conflict' THEN 1 ELSE 2 END,
                     t.updated_at DESC
            """,
            tuple(params),
        ).fetchall()
    result = [_row(row) for row in rows]
    if user.get("role") == "reviewer":
        for item in result:
            if item.get("case_stage") == "completed":
                item["case_status"] = "completed"
    if result:
        case_ids = sorted({str(item["case_id"]) for item in result})
        with db.connect() as conn:
            artifacts = conn.execute(
                f"""
                SELECT case_id, payload_json, created_by
                FROM review_artifacts
                WHERE artifact_type IN ('expert_opinion', 'expert_conflict')
                  AND case_id IN ({','.join('?' for _ in case_ids)})
                """,
                tuple(case_ids),
            ).fetchall()
        _decorate_task_audit(result, [_row(item) for item in artifacts])
    return result


def get_task(task_id: str, user: dict) -> dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT t.*, c.title AS case_title, c.stage AS case_stage,
                   c.status AS case_status, c.doc_id, c.round,
                   d.name AS doc_name, d.kind AS doc_kind, d.warning AS doc_warning
            FROM review_tasks t
            JOIN review_cases c ON c.id = t.case_id
            JOIN documents d ON d.id = c.doc_id
            WHERE t.id = ?
            """,
            (task_id,),
        ).fetchone()
        if not row:
            raise ValueError("审核任务不存在")
        if user.get("role") == "reviewer" and row["assignee_username"] != user.get("username"):
            raise PermissionError("无权访问其他专家的审核任务")
        if user.get("role") not in {"reviewer", "manager", "admin"}:
            raise PermissionError("无权访问专家任务")
        artifacts = conn.execute(
            """
            SELECT * FROM review_artifacts
            WHERE case_id = ? AND artifact_type IN ('pre_review', 'tool_check')
            ORDER BY created_at DESC, id DESC
            """,
            (row["case_id"],),
        ).fetchall()
        audit_artifacts = conn.execute(
            """
            SELECT payload_json, created_by FROM review_artifacts
            WHERE case_id = ? AND artifact_type IN ('expert_opinion', 'expert_conflict')
            """,
            (row["case_id"],),
        ).fetchall()
    data = _row(row) or {}
    if user.get("role") == "reviewer" and data.get("case_stage") == "completed":
        data["case_status"] = "completed"
    if user.get("role") == "reviewer":
        data.pop("round", None)
    _decorate_task_audit([data], [_row(item) for item in audit_artifacts])
    latest: dict[str, dict[str, Any]] = {}
    for artifact in artifacts:
        parsed = _artifact_row(artifact)
        if user.get("role") == "reviewer":
            parsed.pop("round", None)
            parsed.pop("flow_id", None)
        latest.setdefault(parsed["artifact_type"], parsed)
    data["pre_review"] = latest.get("pre_review")
    data["tool_check"] = latest.get("tool_check")
    return data


def submit_task(
    task_id: str,
    user: dict,
    *,
    recommendation: str,
    opinion: str,
    conflict_declared: bool,
    conflict_reason: str,
) -> dict[str, Any]:
    username = str(user.get("username", ""))
    opinion = opinion.strip()
    conflict_reason = conflict_reason.strip()
    if conflict_declared and not conflict_reason:
        raise ValueError("声明回避时必须填写原因")
    if not conflict_declared:
        if recommendation not in _RECOMMENDATIONS:
            raise ValueError("请选择审核建议")
        if len(opinion) < 10:
            raise ValueError("审核意见至少填写 10 个字")
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT t.*, c.doc_id, c.round, c.title AS case_title
            FROM review_tasks t
            JOIN review_cases c ON c.id = t.case_id
            WHERE t.id = ?
            """,
            (task_id,),
        ).fetchone()
        if not row:
            raise ValueError("审核任务不存在")
        case = _locked_case(conn, row["case_id"])
        if not case or case["stage"] != "expert_review":
            raise ValueError("案卷不在专家审核阶段，不能提交任务")
        admin_debug = (
            user.get("role") == "admin"
            and row["assignee_username"] != username
        )
        if row["assignee_username"] != username and not admin_debug:
            raise PermissionError("只能提交本人的审核任务")
        if row["status"] != "assigned":
            raise ValueError("该任务已提交，不能覆盖")
        stamp = db.now()
        debug_line = (
            f"- 管理员调试，原指派账号：{row['assignee_username']}\n"
            if admin_debug
            else ""
        )
        if conflict_declared:
            status = "conflict"
            recommendation_value = None
            opinion_value = ""
            artifact_type = "expert_conflict"
            content = (
                f"# 专家回避声明\n\n"
                f"- 案卷：{row['case_title']}\n"
                f"- 专家：{row['expert_name']}\n"
                f"- 审核账号：{username}\n"
                f"{debug_line}"
                f"- 回避原因：{conflict_reason}\n"
            )
            payload = {"conflict": True, "reason": conflict_reason}
        else:
            status = "submitted"
            recommendation_value = recommendation
            opinion_value = opinion
            artifact_type = "expert_opinion"
            content = (
                f"# 专家审核意见\n\n"
                f"- 专家：{row['expert_name']}（{row['expert_institution']} / {row['expert_title']}）\n"
                f"- 审核建议：{_RECOMMENDATIONS[recommendation]}\n"
                f"- 提交账号：{username}\n"
                f"{debug_line}"
                f"- 提交时间：{stamp}\n\n"
                f"## 审核意见\n\n{opinion}\n"
            )
            payload = {"recommendation": recommendation, "opinion": opinion}
        if admin_debug:
            payload.update({"admin_debug": True, "assignee_username": row["assignee_username"]})
        payload["task_id"] = task_id
        updated = conn.execute(
            """
            UPDATE review_tasks
            SET status = ?, conflict_declared = ?, conflict_reason = ?,
                recommendation = ?, opinion = ?, submitted_at = ?, updated_at = ?
            WHERE id = ? AND status = 'assigned'
            """,
            (
                status,
                1 if conflict_declared else 0,
                conflict_reason if conflict_declared else "",
                recommendation_value,
                opinion_value,
                stamp,
                stamp,
                task_id,
            ),
        )
        if not updated.rowcount:
            raise ValueError("该任务已提交，不能覆盖")
        artifact_id = _artifact(
            conn,
            case_id=row["case_id"],
            stage="expert_review",
            artifact_type=artifact_type,
            title=f"{row['expert_name']} · {ARTIFACT_TYPES[artifact_type]}",
            round_number=row["round"],
            content=content,
            payload=payload,
            source_doc_id=row["doc_id"],
            actor=username,
        )
        _action(
            conn,
            row["case_id"],
            username,
            "expert_conflict" if conflict_declared else "expert_submitted",
            {"artifact_id": artifact_id},
            task_id=task_id,
        )
        conn.execute(
            "UPDATE review_cases SET updated_by = ?, updated_at = ? WHERE id = ?",
            (username, stamp, row["case_id"]),
        )
        case_id = row["case_id"]
    return get_case(case_id, user)


def advance_to_final(case_id: str, actor: str) -> dict[str, Any]:
    with db.connect() as conn:
        case = _locked_case(conn, case_id)
        if not case:
            raise ValueError("评审案卷不存在")
        if case["stage"] != "expert_review":
            raise ValueError("当前案卷不在专家审核阶段")
        pending = conn.execute(
            "SELECT COUNT(*) FROM review_tasks WHERE case_id = ? AND status = 'assigned'",
            (case_id,),
        ).fetchone()[0]
        submitted = conn.execute(
            "SELECT COUNT(*) FROM review_tasks WHERE case_id = ? AND status = 'submitted'",
            (case_id,),
        ).fetchone()[0]
        if pending:
            raise ValueError("仍有专家任务未提交")
        if not submitted:
            raise ValueError("至少需要一份已提交的专家意见")
        stamp = db.now()
        updated = conn.execute(
            """
            UPDATE review_cases
            SET stage = 'final_review', status = 'in_review',
                updated_by = ?, updated_at = ?
            WHERE id = ? AND stage = 'expert_review'
            """,
            (actor, stamp, case_id),
        )
        if not updated.rowcount:
            raise ValueError("案卷已进入其他阶段，请刷新后重试")
        _action(conn, case_id, actor, "expert_review_completed", {"submitted": submitted})
    return get_case(case_id, {"username": actor, "role": "manager"})


def finalize_case(
    case_id: str,
    actor: str,
    *,
    decision: str,
    comment: str,
) -> dict[str, Any]:
    comment = comment.strip()
    if decision not in DECISIONS:
        raise ValueError("终审决定无效")
    if len(comment) < 10:
        raise ValueError("终审意见至少填写 10 个字")
    with db.connect() as conn:
        case = _locked_case(conn, case_id)
        if not case:
            raise ValueError("评审案卷不存在")
        if case["stage"] != "final_review":
            raise ValueError("当前案卷不在终审阶段")
        tasks = conn.execute(
            "SELECT * FROM review_tasks WHERE case_id = ? ORDER BY created_at, id",
            (case_id,),
        ).fetchall()
        if any(task["status"] == "assigned" for task in tasks):
            raise ValueError("仍有专家任务未提交")
        if not any(task["status"] == "submitted" for task in tasks):
            raise ValueError("至少需要一份已提交的专家意见")
        stamp = db.now()
        content = [
            f"# 终审决定 · {case['title']}",
            "",
            f"- 决定：{DECISIONS[decision]}",
            f"- 终审账号：{actor}",
            f"- 时间：{stamp}",
            "",
            "## 专家意见汇总",
            "",
        ]
        artifacts = [_row(row) or {} for row in conn.execute(
            "SELECT * FROM review_artifacts WHERE case_id = ? AND artifact_type IN ('expert_opinion', 'expert_conflict')",
            (case_id,),
        ).fetchall()]
        task_dicts = [dict(task) for task in tasks]
        _decorate_task_audit(task_dicts, artifacts)
        tasks = task_dicts
        for task in tasks:
            if task["status"] == "submitted":
                debug_note = f"（管理员 {task['submitted_by']} 代提交，原指派账号 {task['assignee_username']}）" if task.get("admin_debug") else ""
                content.append(
                    f"### {task['expert_name']}{debug_note}\n\n"
                    f"{_RECOMMENDATIONS.get(task['recommendation'], task['recommendation'])}：{task['opinion']}"
                )
            elif task["status"] == "conflict":
                debug_note = f"（管理员 {task['submitted_by']} 代提交，原指派账号 {task['assignee_username']}）" if task.get("admin_debug") else ""
                content.append(f"### {task['expert_name']}{debug_note}\n\n已回避：{task['conflict_reason']}")
        content.extend(["", "## 终审意见", "", comment, ""])
        task_audit = [
            {
                "task_id": task["id"],
                "expert_name": task["expert_name"],
                "status": task["status"],
                "assignee_username": task["assignee_username"],
                "admin_debug": bool(task.get("admin_debug")),
                "submitted_by": task.get("submitted_by", ""),
            }
            for task in tasks
        ]
        artifact_id = _artifact(
            conn,
            case_id=case_id,
            stage="final_review",
            artifact_type="final_decision",
            title=f"终审决定 · {DECISIONS[decision]}",
            round_number=case["round"],
            content="\n".join(content),
            payload={"decision": decision, "comment": comment, "task_audit": task_audit},
            source_doc_id=case["doc_id"],
            actor=actor,
        )
        updated = conn.execute(
            """
            UPDATE review_cases
            SET stage = 'completed', status = ?, final_decision = ?,
                final_comment = ?, updated_by = ?, updated_at = ?
            WHERE id = ? AND stage = 'final_review'
            """,
            (decision, decision, comment, actor, stamp, case_id),
        )
        if not updated.rowcount:
            raise ValueError("案卷已完成终审或状态已变化，请刷新后重试")
        _action(
            conn,
            case_id,
            actor,
            "final_decision",
            {"decision": decision, "artifact_id": artifact_id, "task_audit": task_audit},
        )
    return get_case(case_id, {"username": actor, "role": "admin"})


def list_artifacts(user: dict, case_id: str | None = None) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if case_id:
        clauses.append("a.case_id = ?")
        params.append(case_id)
    if user.get("role") == "reviewer":
        clauses.append(
            "EXISTS (SELECT 1 FROM review_tasks t WHERE t.case_id = a.case_id AND t.assignee_username = ?)"
        )
        params.append(user.get("username", ""))
    elif user.get("role") not in {"admin", "manager"}:
        raise PermissionError("无权访问评审归档")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with db.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT a.*, c.title AS case_title,
                   COALESCE(NULLIF(d.name, ''), NULLIF(a.source_doc_name, ''), '来源文档已删除或未记录') AS doc_name,
                   COALESCE(r.root_case_id, c.id) AS flow_id
            FROM review_artifacts a
            JOIN review_cases c ON c.id = a.case_id
            LEFT JOIN review_case_rounds r ON r.case_id = c.id
            LEFT JOIN documents d ON d.id = a.source_doc_id
            {where}
            ORDER BY a.created_at DESC, a.id DESC
            """,
            tuple(params),
        ).fetchall()
    visible = (row for row in rows if _artifact_visible(row, user))
    result = [_artifact_row(row) for row in visible]
    if user.get("role") == "reviewer":
        for artifact in result:
            artifact.pop("round", None)
            artifact.pop("flow_id", None)
    return result


def get_artifact(artifact_id: str, user: dict) -> dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT a.*, c.title AS case_title,
                   COALESCE(NULLIF(d.name, ''), NULLIF(a.source_doc_name, ''), '来源文档已删除或未记录') AS doc_name,
                   COALESCE(r.root_case_id, c.id) AS flow_id
            FROM review_artifacts a
            JOIN review_cases c ON c.id = a.case_id
            LEFT JOIN review_case_rounds r ON r.case_id = c.id
            LEFT JOIN documents d ON d.id = a.source_doc_id
            WHERE a.id = ?
            """,
            (artifact_id,),
        ).fetchone()
        if not row:
            raise ValueError("归档记录不存在")
        _require_access(conn, row["case_id"], user)
        if not _artifact_visible(row, user):
            raise PermissionError("无权访问其他专家的审核记录")
    result = _artifact_row(row)
    if user.get("role") == "reviewer":
        result.pop("round", None)
        result.pop("flow_id", None)
    return result
