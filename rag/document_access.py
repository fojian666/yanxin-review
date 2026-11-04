"""材料可参与内部查重，但其内容只能由有阅读权的账号获得。"""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

from . import db

RESTRICTED_NOTE = "对方材料受保护，仅展示本材料的相似位置与相似度；对方原文须经授权核验。"


class DocumentAccessDenied(PermissionError):
    """可向客户端公开的材料授权拒绝，与文件系统权限异常分开。"""


def is_public(doc: dict) -> bool:
    # 只认可明确来源，不能仅因 kind=paper/policy 就公开上传材料。
    return doc.get("source") == "demo" or (
        doc.get("source") == "public" and doc.get("kind") in {"policy", "paper"}
    )


def public_ids() -> set[str]:
    with db.connect() as conn:
        policies = {row["doc_id"]: row["visibility"] for row in conn.execute("SELECT doc_id, visibility FROM document_access").fetchall()}
    return {doc["id"] for doc in db.list_documents() if policies.get(doc["id"], "public" if is_public(doc) else "restricted") == "public"}


class Access:
    def __init__(self, user: dict):
        self.user = user
        self.manager = user.get("role") in {"manager", "admin"}
        self.username = user.get("username", "")
        self._audited: set[tuple[str, str]] = set()
        self.docs = {doc["id"]: doc for doc in db.list_documents()}
        with db.connect() as conn:
            self.policies = {row["doc_id"]: dict(row) for row in conn.execute("SELECT * FROM document_access").fetchall()}
            assigned = conn.execute(
                "SELECT DISTINCT c.doc_id FROM review_tasks t JOIN review_cases c ON c.id = t.case_id WHERE t.assignee_username = ?",
                (self.username,),
            ).fetchall() if user.get("role") == "reviewer" else []
        self.assigned = {row["doc_id"] for row in assigned}
        self.readable = {doc_id for doc_id in self.docs if self._readable(doc_id)}

    def policy(self, doc_id: str) -> dict:
        row = self.policies.get(doc_id)
        return {
            "owner_username": row["owner_username"] if row else "",
            "visibility": row["visibility"] if row else "public" if is_public(self.docs.get(doc_id, {})) else "restricted",
            "readers": json.loads(row["readers_json"]) if row else [],
        }

    def _readable(self, doc_id: str) -> bool:
        policy = self.policy(doc_id)
        return self.manager or policy["visibility"] == "public" or bool(self.username) and (
            policy["owner_username"] == self.username or self.username in policy["readers"] or doc_id in self.assigned
        )

    def can_read(self, doc_id: str) -> bool:
        return doc_id in self.readable

    def require(self, doc_id: str) -> None:
        if not self.can_read(doc_id):
            # 不区分不存在与无权访问，避免枚举受控材料。
            raise DocumentAccessDenied("未找到该材料或无权读取")

    def scope(self, requested: list[str] | None) -> list[str]:
        if requested:
            for doc_id in requested:
                self.require(doc_id)
            return list(dict.fromkeys(requested))
        return sorted(self.readable)

    def documents(self) -> list[dict]:
        return [{**doc, "can_check": self.can_check(doc["id"])} for doc in self.docs.values() if self.can_read(doc["id"])]

    def can_check(self, doc_id: str) -> bool:
        return self.can_read(doc_id) and (self.manager or self.user.get("role") == "reviewer" or self.policy(doc_id)["owner_username"] == self.username)

    def can_dossier(self, dossier_id: str) -> bool:
        if self.manager:
            return True
        return any(
            item["doc_id"] in self.assigned or
            self.policy(item["doc_id"])["owner_username"] == self.username or
            self.username in self.policy(item["doc_id"])["readers"]
            for item in db.list_dossier_documents(dossier_id)
        )

    def audit(self, doc_ids: list[str], channel: str) -> None:
        protected = {doc_id for doc_id in doc_ids if self.can_read(doc_id) and self.policy(doc_id)["visibility"] != "public"
                     and (doc_id, channel) not in self._audited}
        if not protected:
            return
        with db.connect() as conn:
            for doc_id in protected:
                _event(conn, doc_id, self.username, "read", {"channel": channel})
        self._audited.update((doc_id, channel) for doc_id in protected)

    def duplicate(self, result: dict) -> dict:
        projected = copy.deepcopy(result)
        hidden = False
        for index, match in enumerate(projected.get("matches") or [], 1):
            if self.can_read(match.get("matched_doc_id", "")):
                continue
            hidden = True
            # 显式白名单，不让后续新增字段顺带泄漏对方内容。
            safe = {key: match[key] for key in ("similarity", "source_snippet") if key in match}
            safe.update(matched_doc_id="", matched_doc_name=f"受保护比对材料 {index}", matched_snippet="",
                        restricted=True, reference_id=f"restricted-{index}")
            match.clear()
            match.update(safe)
        if hidden:
            projected["access_note"] = RESTRICTED_NOTE
        return projected

    def tool(self, result: dict, audit_channel: str = "duplicate-evidence") -> dict:
        projected = copy.deepcopy(result)
        projected["duplicate"] = self.duplicate(result.get("duplicate") or {})
        self.audit([m.get("matched_doc_id", "") for m in result.get("duplicate", {}).get("matches") or []], audit_channel)
        return projected

    def report(self, report: dict, audit_channel: str = "review-evidence") -> dict:
        projected = copy.deepcopy(report)
        # 这些ID只用于服务器动态核验，不作为报告字段发给受限阅读者。
        narrative_sources = projected.pop("narrative_source_ids", None)
        projected["duplicate"] = self.duplicate(report.get("duplicate") or {})
        hidden = bool(projected["duplicate"].get("access_note"))
        for section in projected.get("sections") or []:
            for item in section.get("items") or []:
                source_id = item.get("source_doc_id")
                if source_id and not self.can_read(source_id):
                    hidden = True
                    safe = {
                        "label": "受保护来源的相似内容" if section.get("key") == "duplicate" else "受保护参考依据",
                        "status": item.get("status", "warn"),
                        "detail": RESTRICTED_NOTE if section.get("key") == "duplicate" else "该依据须经授权后核验。",
                        "evidence": "", "restricted": True,
                    }
                    item.clear()
                    item.update(safe)
        snapshot_valid = isinstance(narrative_sources, list) and all(isinstance(source, str) for source in narrative_sources)
        legacy = report.get("privacy_version") != 1 or not snapshot_valid
        narrative_denied = not self.manager and report.get("mode") != "offline" and (
            legacy or any(not self.can_read(source) for source in narrative_sources)
        )
        if hidden or narrative_denied:
            projected["access_note"] = RESTRICTED_NOTE
        if narrative_denied:
            # 模型可把政策转述到任何叙述字段。快照缺失时也不猜测来源安全。
            safe_sections = [] if legacy else [section for section in projected.get("sections") or [] if section.get("key") in {"policy", "duplicate"}]
            projected = {key: projected[key] for key in ("doc", "overall", "duplicate", "mode", "generation", "disclaimer", "access_note") if key in projected}
            projected.setdefault("overall", {})["summary"] = "模型报告的依据已受限或缺少来源快照，原模型叙述已隐藏；完整报告由授权管理人员核验。"
            projected["sections"] = safe_sections or [{"key": "duplicate", "title": "文本查重", "status": "warn", "items": []}]
            projected["questions"] = []
            projected["warning"] = "当前只保留可核对的系统检查项，不展示原模型叙述。"
            projected["limitations"] = ["当前显示的是受限阅读摘要，不是原始签名报告。"]
        evidence_ids = [item.get("source_doc_id", "") for section in projected.get("sections") or [] for item in section.get("items") or []]
        evidence_ids.extend(m.get("matched_doc_id", "") for m in projected["duplicate"].get("matches") or [])
        self.audit(evidence_ids, audit_channel)
        return projected

    def artifact(self, artifact: dict) -> dict:
        payload = artifact.get("payload") or {}
        source_ids = [artifact.get("source_doc_id", "")]
        source_ids.extend(m.get("matched_doc_id", "") for m in (payload.get("duplicate") or {}).get("matches") or [])
        if self.manager:
            source_ids.extend(item.get("source_doc_id", "") for section in payload.get("sections") or [] for item in section.get("items") or [])
        self.audit(source_ids, "review-artifact")
        if self.manager or artifact.get("artifact_type") not in {"pre_review", "tool_check"}:
            return artifact
        projected = self.report(payload, "review-artifact") if artifact["artifact_type"] == "pre_review" else self.tool(payload, "review-artifact")
        readable_payload = {key: value for key, value in payload.items() if key != "narrative_source_ids"}
        if projected == readable_payload and payload.get("privacy_version") == 1:
            # 只移除内部来源快照不改变签名正文，无须误标为受限副本。
            return {**artifact, "payload": projected}
        from .review_cases import _review_markdown, _tool_markdown
        content = _review_markdown(projected) if artifact["artifact_type"] == "pre_review" else _tool_markdown(projected)
        content = "当前为按阅读权限生成的副本，原始签名归档保持不变。\n\n" + content
        return {**artifact, "payload": projected, "content": content, "redacted": True,
                "original_sha256": artifact.get("sha256"), "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest()}

    def case(self, case: dict) -> dict:
        return {**case, "artifacts": [self.artifact(a) for a in case.get("artifacts") or []]}

    def task(self, task: dict) -> dict:
        return {**task, **{key: self.artifact(task[key]) for key in ("pre_review", "tool_check") if task.get(key)}}


def _event(conn, doc_id: str, actor: str, action: str, detail: dict) -> None:
    conn.execute(
        "INSERT INTO document_access_events (id, doc_id, actor, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (db.new_id(), doc_id, actor, action, json.dumps(detail, ensure_ascii=False), db.now()),
    )


def set_policy(doc_id: str, actor: str, owner: str, visibility: str, readers: list[str]) -> dict:
    if not db.get_document(doc_id):
        raise ValueError("材料不存在")
    if visibility not in {"public", "restricted"}:
        raise ValueError("无效的阅读范围")
    readers = sorted(set(readers))
    if len(readers) > 100:
        raise ValueError("单份材料最多授权100个账号")
    with db.connect() as conn:
        users = {row["username"] for row in conn.execute("SELECT username FROM users").fetchall()}
        if any(username not in users for username in ([owner] if owner else []) + readers):
            raise ValueError("归属或授权账号不存在")
        before = conn.execute("SELECT * FROM document_access WHERE doc_id = ?", (doc_id,)).fetchone()
        after = {"owner_username": owner, "visibility": visibility, "readers": readers}
        conn.execute(
            """INSERT INTO document_access (doc_id, owner_username, visibility, readers_json) VALUES (?, ?, ?, ?)
            ON CONFLICT (doc_id) DO UPDATE SET owner_username = excluded.owner_username,
            visibility = excluded.visibility, readers_json = excluded.readers_json""",
            (doc_id, owner, visibility, json.dumps(readers)),
        )
        _event(conn, doc_id, actor, "set_access", {"before": dict(before) if before else None, "after": after})
    return after
