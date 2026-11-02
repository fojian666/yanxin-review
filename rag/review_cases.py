from __future__ import annotations

import hashlib
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


def list_cases(user: dict) -> list[dict[str, Any]]:
    role = user.get("role")
    params: tuple[Any, ...] = ()
    where = ""
    if role == "reviewer":
        where = "WHERE EXISTS (SELECT 1 FROM review_tasks mine WHERE mine.case_id = c.id AND mine.assignee_username = ?)"
        params = (user.get("username", ""),)
    elif role not in {"admin", "manager"}:
        raise PermissionError("无权访问评审案卷")
    with db.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT c.*, d.name AS doc_name, d.kind AS doc_kind,
                   COUNT(DISTINCT t.id) AS task_total,
                   SUM(CASE WHEN t.status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
                   SUM(CASE WHEN t.status = 'conflict' THEN 1 ELSE 0 END) AS conflict_count,
                   SUM(CASE WHEN t.status = 'assigned' THEN 1 ELSE 0 END) AS assigned_count,
                   (SELECT COUNT(*) FROM review_artifacts a WHERE a.case_id = c.id) AS artifact_count
            FROM review_cases c
            JOIN documents d ON d.id = c.doc_id
            LEFT JOIN review_tasks t ON t.case_id = c.id
            {where}
            GROUP BY c.id
            ORDER BY c.updated_at DESC, c.created_at DESC
            """,
            params,
        ).fetchall()
    return [_case_summary(row) for row in rows]


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
            SELECT c.*, d.name AS doc_name, d.kind AS doc_kind, d.year AS doc_year,
                   d.text_len AS doc_text_len, d.chunk_count AS doc_chunk_count
            FROM review_cases c
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
    data["tasks"] = [_row(task) for task in tasks]
    data["artifacts"] = [_row(artifact) for artifact in artifacts]
    data["actions"] = [_row(action) for action in actions]
    data["task_total"] = len(tasks)
    data["submitted_count"] = sum(task["status"] == "submitted" for task in tasks)
    data["conflict_count"] = sum(task["status"] == "conflict" for task in tasks)
    data["assigned_count"] = sum(task["status"] == "assigned" for task in tasks)
    data["artifact_count"] = len(artifacts)
    return data


def reviewer_options() -> list[dict[str, str]]:
    return [
        {
            "username": item["username"],
            "display_name": item.get("display_name") or item["username"],
        }
        for item in auth.list_users()
        if item.get("role") == "reviewer"
    ]


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
    transaction.execute(
        """
        INSERT INTO review_artifacts
        (id, case_id, stage, artifact_type, title, round, format, content,
         payload_json, source_doc_id, created_by, created_at, sha256)
        VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, ?, ?)
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
            actor,
            db.now(),
            digest,
        ),
    )
    return artifact_id


def _review_markdown(report: dict[str, Any]) -> str:
    overall = report.get("overall") or {}
    lines = [
        f"# 预审报告 · {report.get('doc', {}).get('name', '')}",
        "",
        f"- 风险等级：{overall.get('risk_level', '')}",
        f"- 检查项：{overall.get('checked_items', 0)}",
        f"- 生成时间：{overall.get('generated_at', '')}",
        "",
        overall.get("summary", ""),
        "",
    ]
    for section in report.get("sections") or []:
        lines.append(f"## {section.get('title', '')}")
        for item in section.get("items") or []:
            lines.append(f"- {item.get('label', '')}：{item.get('detail', '')}")
            if item.get("evidence"):
                lines.append(f"  - 依据：{item['evidence']}")
        lines.append("")
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
        "",
        "## 专家匹配",
        match.get("summary", "未执行"),
        "",
    ]
    for candidate in match.get("candidates") or []:
        expert = candidate.get("expert") or {}
        lines.append(
            f"- {expert.get('name', '')}（{expert.get('institution', '')} / {expert.get('title', '')}）"
        )
    if result.get("disclaimer"):
        lines.extend(["", "---", result["disclaimer"]])
    return "\n".join(lines)


def save_pre_results(
    case_id: str,
    *,
    actor: str,
    report: dict[str, Any],
    tool_result: dict[str, Any],
) -> dict[str, Any]:
    with db.connect() as conn:
        case = conn.execute("SELECT * FROM review_cases WHERE id = ?", (case_id,)).fetchone()
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
        conn.execute(
            """
            UPDATE review_cases
            SET stage = 'expert_review', status = 'in_progress',
                updated_by = ?, updated_at = ?
            WHERE id = ?
            """,
            (actor, db.now(), case_id),
        )
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
        case = conn.execute("SELECT * FROM review_cases WHERE id = ?", (case_id,)).fetchone()
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
        for item in assignments:
            username = str(item.get("username", "")).strip()
            expert_id = int(item.get("expert_id") or 0)
            user = conn.execute("SELECT role FROM users WHERE username = ?", (username,)).fetchone()
            if not user or user["role"] != "reviewer":
                raise ValueError("审核账号必须是评审专家角色")
            if expert_id not in allowed_experts:
                raise ValueError("只能指派通过回避、负载和可用性过滤的候选专家")
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
            conn.execute(
                """
                INSERT INTO review_tasks
                (id, case_id, assignee_username, expert_id, expert_name,
                 expert_institution, expert_title, status, conflict_declared,
                 conflict_reason, recommendation, opinion, submitted_at,
                 created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'assigned', 0, '', NULL, NULL, NULL, ?, ?)
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
    return [_row(row) for row in rows]


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
    data = _row(row) or {}
    latest: dict[str, dict[str, Any]] = {}
    for artifact in artifacts:
        parsed = _row(artifact) or {}
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
        conn.execute(
            """
            UPDATE review_tasks
            SET status = ?, conflict_declared = ?, conflict_reason = ?,
                recommendation = ?, opinion = ?, submitted_at = ?, updated_at = ?
            WHERE id = ?
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
        case = conn.execute("SELECT * FROM review_cases WHERE id = ?", (case_id,)).fetchone()
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
        conn.execute(
            """
            UPDATE review_cases
            SET stage = 'final_review', status = 'in_review',
                updated_by = ?, updated_at = ?
            WHERE id = ?
            """,
            (actor, stamp, case_id),
        )
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
        case = conn.execute("SELECT * FROM review_cases WHERE id = ?", (case_id,)).fetchone()
        if not case:
            raise ValueError("评审案卷不存在")
        if case["stage"] != "final_review":
            raise ValueError("当前案卷不在终审阶段")
        tasks = conn.execute(
            "SELECT * FROM review_tasks WHERE case_id = ? ORDER BY created_at, id",
            (case_id,),
        ).fetchall()
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
        for task in tasks:
            if task["status"] == "submitted":
                content.append(
                    f"### {task['expert_name']}\n\n"
                    f"{_RECOMMENDATIONS.get(task['recommendation'], task['recommendation'])}：{task['opinion']}"
                )
            elif task["status"] == "conflict":
                content.append(f"### {task['expert_name']}\n\n已回避：{task['conflict_reason']}")
        content.extend(["", "## 终审意见", "", comment, ""])
        artifact_id = _artifact(
            conn,
            case_id=case_id,
            stage="final_review",
            artifact_type="final_decision",
            title=f"终审决定 · {DECISIONS[decision]}",
            round_number=case["round"],
            content="\n".join(content),
            payload={"decision": decision, "comment": comment},
            source_doc_id=case["doc_id"],
            actor=actor,
        )
        conn.execute(
            """
            UPDATE review_cases
            SET stage = 'completed', status = ?, final_decision = ?,
                final_comment = ?, updated_by = ?, updated_at = ?
            WHERE id = ?
            """,
            (decision, decision, comment, actor, stamp, case_id),
        )
        _action(
            conn,
            case_id,
            actor,
            "final_decision",
            {"decision": decision, "artifact_id": artifact_id},
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
            SELECT a.*, c.title AS case_title, d.name AS doc_name
            FROM review_artifacts a
            JOIN review_cases c ON c.id = a.case_id
            JOIN documents d ON d.id = a.source_doc_id
            {where}
            ORDER BY a.created_at DESC, a.id DESC
            """,
            tuple(params),
        ).fetchall()
    visible = (row for row in rows if _artifact_visible(row, user))
    return [_row(row) for row in visible]


def get_artifact(artifact_id: str, user: dict) -> dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT a.*, c.title AS case_title, d.name AS doc_name
            FROM review_artifacts a
            JOIN review_cases c ON c.id = a.case_id
            JOIN documents d ON d.id = a.source_doc_id
            WHERE a.id = ?
            """,
            (artifact_id,),
        ).fetchone()
        if not row:
            raise ValueError("归档记录不存在")
        _require_access(conn, row["case_id"], user)
        if not _artifact_visible(row, user):
            raise PermissionError("无权访问其他专家的审核记录")
    return _row(row) or {}
