"""课题卷宗与申报包体检。

这里只管理“材料是否归卷、版本、人工确认和文本线索”，不复制官方系统的
受理、推荐、审批、验收等状态。所有结论都用于提示人工核对。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from . import db
from .text import truncate

PLAN_TYPES = {
    "directive": "指令性",
    "guidance": "指导性",
}

PHASES = {
    "application": "申报准备",
    "implementation": "实施材料",
    "acceptance": "验收材料",
    "closing": "结题备案",
}

MATERIAL_ROLES = {
    "proposal_text": {
        "label": "申请书（可编辑版）",
        "short": "申请书",
        "verify": False,
    },
    "signed_proposal": {
        "label": "申请书（盖章扫描件）",
        "short": "盖章申请书",
        "verify": True,
    },
    "integrity_pledge": {
        "label": "科研诚信承诺书",
        "short": "诚信承诺书",
        "verify": True,
    },
    "supervisor_recommendation": {
        "label": "主管部门推荐 / 汇总材料",
        "short": "主管部门材料",
        "verify": True,
    },
    "contract": {
        "label": "课题合同",
        "short": "合同",
        "verify": True,
    },
    "implementation_commitment": {
        "label": "课题实施承诺书",
        "short": "实施承诺书",
        "verify": True,
    },
    "acceptance_application": {
        "label": "验收申请",
        "short": "验收申请",
        "verify": False,
    },
    "performance_self_review": {
        "label": "绩效自评价报告",
        "short": "绩效自评",
        "verify": True,
    },
    "financial_settlement": {
        "label": "经费财务决算资料",
        "short": "财务决算",
        "verify": True,
    },
    "achievement_report": {
        "label": "课题成果报告",
        "short": "成果报告",
        "verify": False,
    },
    "advisory_note": {
        "label": "科技咨政建议",
        "short": "咨政建议",
        "verify": False,
    },
    "paper": {
        "label": "论文及研究成果",
        "short": "论文成果",
        "verify": False,
    },
    "expert_opinion": {
        "label": "专家评价意见",
        "short": "专家意见",
        "verify": True,
    },
    "closing_materials": {
        "label": "结题备案材料",
        "short": "备案材料",
        "verify": True,
    },
    "other": {
        "label": "其他卷宗材料",
        "short": "其他材料",
        "verify": False,
    },
}

DISCLAIMER = (
    "卷宗体检只核对本地已收录材料、材料角色、版本、人工确认状态与可读取文本线索，"
    "不验证公章和签字真实性，不替代主管部门受理、评审、立项、验收或结题结论。"
)

LIMITATIONS = [
    "盖章、签字和主管部门推荐状态须由有权限的人员确认，系统不能自动证明其真实性。",
    "扫描版 PDF 当前没有 OCR；系统只能确认文件已归卷，不能读取扫描页中的盖章和字段。",
    "本检查不代表官方系统已受理或已通过任何流程节点。",
]


def options() -> dict[str, Any]:
    return {
        "plan_types": [{"value": key, "label": value} for key, value in PLAN_TYPES.items()],
        "phases": [{"value": key, "label": value} for key, value in PHASES.items()],
        "material_roles": [
            {
                "value": key,
                "label": value["label"],
                "short": value["short"],
                "requires_verification": value["verify"],
            }
            for key, value in MATERIAL_ROLES.items()
        ],
    }


def validate(values: dict[str, Any]) -> None:
    if "name" in values and not str(values.get("name") or "").strip():
        raise ValueError("课题名称不能为空")
    if "plan_type" in values and values.get("plan_type") not in PLAN_TYPES:
        raise ValueError("计划类型必须为指令性或指导性")
    if "phase" in values and values.get("phase") not in PHASES:
        raise ValueError("材料阶段无效")
    role = values.get("role")
    if role is not None and role not in MATERIAL_ROLES:
        raise ValueError("材料角色无效")


def dossier_summary(dossier: dict[str, Any]) -> dict[str, Any]:
    materials = db.list_dossier_documents(dossier["id"])
    current = [item for item in materials if item["is_current"]]
    return {
        **dossier,
        "plan_type_label": PLAN_TYPES.get(dossier["plan_type"], dossier["plan_type"]),
        "phase_label": PHASES.get(dossier["phase"], dossier["phase"]),
        "materials": materials,
        "current_material_count": len(current),
        "verified_material_count": sum(1 for item in current if item["human_verified"]),
    }


def _status(items: list[dict[str, Any]]) -> str:
    values = {item["status"] for item in items}
    if "fail" in values:
        return "fail"
    if "warn" in values:
        return "warn"
    return "pass"


def _material(
    materials: list[dict[str, Any]],
    role: str,
    *,
    required: bool = True,
) -> dict[str, Any]:
    config = MATERIAL_ROLES[role]
    item = next(
        (
            material
            for material in materials
            if material["role"] == role and material["is_current"]
        ),
        None,
    )
    if not item:
        return {
            "key": f"material-{role}",
            "label": config["label"],
            "status": "fail" if required else "pass",
            "detail": (
                "卷宗中尚未归入该类材料。"
                if required
                else "卷宗中未归入该材料；本地体检不强制要求，若主管部门另有要求需人工核对。"
            ),
            "evidence": "",
            "role": role,
            "doc_id": "",
            "requires_human_verification": config["verify"],
        }

    evidence = f"当前版本：{item['doc_name']}（v{item['version']}）"
    scan_role = role in {"signed_proposal", "integrity_pledge"}
    wrong_scan_format = bool(
        item["doc_suffix"] and item["doc_suffix"] != ".pdf" and scan_role
    )
    if wrong_scan_format:
        evidence += "；该角色通常应为盖章扫描 PDF"
    if wrong_scan_format:
        status = "warn"
        detail = "材料已归卷，但不是 PDF 盖章扫描件；请核对格式并完成人工确认。"
    elif config["verify"] and not item["human_verified"]:
        status = "warn"
        detail = "材料已归卷，但盖章、签字或推荐状态尚未经人工确认。"
    else:
        status = "pass"
        detail = (
            "材料已归卷并完成人工确认。"
            if config["verify"]
            else "材料已归卷。"
        )
    return {
        "key": f"material-{role}",
        "label": config["label"],
        "status": status,
        "detail": detail,
        "evidence": evidence,
        "role": role,
        "doc_id": item["doc_id"],
        "requires_human_verification": config["verify"],
    }


def _field(
    dossier: dict[str, Any],
    key: str,
    label: str,
    *,
    severity: str = "warn",
) -> dict[str, Any]:
    value = str(dossier.get(key) or "").strip()
    return {
        "key": f"field-{key}",
        "label": label,
        "status": "pass" if value else severity,
        "detail": (
            f"已填写：{value}"
            if value
            else f"尚未填写{label}，请在卷宗信息中补充。"
        ),
        "evidence": value,
        "role": "",
        "doc_id": "",
        "requires_human_verification": False,
    }


def _proposal_text(materials: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    proposal = next(
        (
            item
            for item in materials
            if item["role"] == "proposal_text" and item["is_current"]
        ),
        None,
    )
    if not proposal:
        return None, ""
    text = "\n".join(chunk["text"] for chunk in db.get_chunks(proposal["doc_id"]))
    return proposal, text


def _indicator_check(dossier: dict[str, Any], materials: list[dict[str, Any]]) -> dict[str, Any]:
    proposal, text = _proposal_text(materials)
    plan = dossier["plan_type"]
    if not proposal:
        return {
            "key": "indicators",
            "label": "计划类型对应考核指标",
            "status": "fail",
            "detail": "未归入申请书正文，无法核对考核指标。",
            "evidence": "",
            "role": "proposal_text",
            "doc_id": "",
            "requires_human_verification": False,
        }

    required = ["研究报告", "论文"]
    if plan == "directive":
        required.append("科技咨政报告")
    aliases = {
        "研究报告": ["研究报告", "项目研究报告"],
        "论文": ["论文"],
        "科技咨政报告": ["科技咨政报告", "科技资政报告", "咨政报告"],
    }
    missing = [
        label
        for label in required
        if not any(term in text for term in aliases[label])
    ]
    evidence_lines = []
    for label in required:
        lines = [
            line.strip()
            for line in text.splitlines()
            if any(term in line for term in aliases[label])
        ]
        if lines:
            evidence_lines.append(f"{label}：{truncate(lines[0], 90)}")
    return {
        "key": "indicators",
        "label": "计划类型对应考核指标",
        "status": "warn" if missing else "pass",
        "detail": (
            f"未在申请书正文中识别：{'、'.join(missing)}。"
            if missing
            else f"已识别{'、'.join(required)}相关表述，仍须核对数量与验收标准。"
        ),
        "evidence": "；".join(evidence_lines),
        "role": "proposal_text",
        "doc_id": proposal["doc_id"],
        "requires_human_verification": False,
    }


def checklist(dossier_id: str) -> dict[str, Any] | None:
    dossier = db.get_dossier(dossier_id)
    if not dossier:
        return None
    materials = db.list_dossier_documents(dossier_id)

    base_items = [
        _field(dossier, "year", "申报年度", severity="warn"),
        _field(dossier, "applicant_unit", "申报 / 承担单位", severity="warn"),
        _field(dossier, "leader", "课题负责人", severity="warn"),
        _field(dossier, "supervisor", "申报单位主管部门", severity="fail"),
    ]
    application_items = [
        _material(materials, "proposal_text"),
        _material(materials, "signed_proposal"),
        _material(materials, "integrity_pledge"),
        _indicator_check(dossier, materials),
    ]
    application_items.append(
        _material(materials, "supervisor_recommendation", required=False)
    )

    sections: list[dict[str, Any]] = [
        {
            "key": "dossier",
            "title": "卷宗基础信息",
            "status": _status(base_items),
            "items": base_items,
        },
        {
            "key": "application",
            "title": "申报材料",
            "status": _status(application_items),
            "items": application_items,
        },
    ]

    phase = dossier["phase"]
    if phase in {"implementation", "acceptance", "closing"}:
        implementation_role = (
            "contract" if dossier["plan_type"] == "directive" else "implementation_commitment"
        )
        implementation_items = [_material(materials, implementation_role)]
        sections.append(
            {
                "key": "implementation",
                "title": "实施材料",
                "status": _status(implementation_items),
                "items": implementation_items,
            }
        )

    if phase in {"acceptance", "closing"}:
        acceptance_roles = [
            "acceptance_application",
            "performance_self_review",
            "financial_settlement",
            "achievement_report",
            "paper",
        ]
        if dossier["plan_type"] == "directive":
            acceptance_roles.append("advisory_note")
        acceptance_items = [_material(materials, role) for role in acceptance_roles]
        sections.append(
            {
                "key": "acceptance",
                "title": "验收材料",
                "status": _status(acceptance_items),
                "items": acceptance_items,
            }
        )

    if phase == "closing":
        closing_items = [
            _material(materials, "closing_materials"),
            _material(
                materials,
                "expert_opinion",
                required=dossier["plan_type"] == "directive",
            ),
        ]
        sections.append(
            {
                "key": "closing",
                "title": "备案结题",
                "status": _status(closing_items),
                "items": closing_items,
            }
        )

    items = [item for section in sections for item in section["items"]]
    fail = sum(item["status"] == "fail" for item in items)
    warn = sum(item["status"] == "warn" for item in items)
    passed = sum(item["status"] == "pass" for item in items)
    overall_status = _status(items)
    return {
        "dossier": dossier_summary(dossier),
        "overall": {
            "status": overall_status,
            "summary": (
                f"本阶段检查 {len(items)} 项：已具备 {passed} 项、"
                f"需关注 {warn} 项、缺项 {fail} 项。"
            ),
            "checked_items": len(items),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        },
        "sections": sections,
        "limitations": LIMITATIONS,
        "disclaimer": DISCLAIMER,
    }
