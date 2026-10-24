"""系统间数据接入服务：把外部推送的规范化数据写入本地库（幂等去重）。"""
from __future__ import annotations

from . import db
from .schemas import ExternalExpert, ExternalPaper


def ingest_experts(items: list[ExternalExpert]) -> tuple[int, int]:
    """逐条写入专家；返回 (新增, 跳过)。同名同单位视为已存在。"""
    inserted = skipped = 0
    known = db.expert_keys()
    for item in items:
        row = item.to_row()
        row["source"] = "system"
        if db.insert_expert_if_new(row, known):
            inserted += 1
        else:
            skipped += 1
    return inserted, skipped


def ingest_papers(items: list[ExternalPaper]) -> tuple[int, int]:
    """逐条写入文献；返回 (新增, 跳过)。同标题同年份视为已存在。"""
    inserted = skipped = 0
    known = db.paper_keys()
    for item in items:
        row = item.to_row()
        row["source"] = "system"
        if db.insert_paper_if_new(row, known):
            inserted += 1
        else:
            skipped += 1
    return inserted, skipped
