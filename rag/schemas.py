"""外部数据接入契约。

当前库内文献/专家/示例本子均为演示数据。真实数据接入有三条路径：
1. 界面 CSV 导入（人工批量，已有）；
2. /api/ingest/* JSON 推送（系统间对接，见 app.py）；
3. 只读 API 拉取（规划中：省厅科技管理系统数据外挂，实施方案 §7）。

字段名与 CSV 表头（parsers/experts 的 HEADER_ALIASES）保持一致，
便于同一套映射对接省厅数据字典。
ProjectRecord / IntegrityRecord / PolicyMeta 为预留结构：存储与功能尚未启用，
先行冻结字段，外部系统可据此准备数据。
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class ExternalExpert(BaseModel):
    """推送到 /api/ingest/experts 的专家记录。"""

    name: str = Field(..., min_length=1, description="姓名")
    institution: str = Field("", description="所在单位")
    title: str = Field("", description="职称")
    discipline: str = Field("", description="学科")
    research_areas: list[str] = Field(default_factory=list, description="研究方向")
    achievements: str = Field("", description="代表性成果")
    avoid_institutions: list[str] = Field(default_factory=list, description="回避单位")
    avoid_people: list[str] = Field(default_factory=list, description="回避人员")
    workload: int = Field(0, ge=0, description="在研项目数；>=5 视为负载已满")
    available: bool = Field(True, description="是否可评审")

    def to_row(self) -> dict:
        def join(items: list[str]) -> str:
            return ";".join(x.strip() for x in items if x.strip())

        return {
            "name": self.name.strip(),
            "institution": self.institution.strip(),
            "title": self.title.strip(),
            "discipline": self.discipline.strip(),
            "research_areas": join(self.research_areas),
            "achievements": self.achievements.strip(),
            "avoid_institutions": join(self.avoid_institutions),
            "avoid_people": join(self.avoid_people),
            "workload": self.workload,
            "available": self.available,
        }


class ExternalPaper(BaseModel):
    """推送到 /api/ingest/papers 的文献记录。"""

    title: str = Field(..., min_length=1, description="标题")
    year: int | None = Field(None, ge=1980, le=2100, description="发表年份")
    authors: str = Field("", description="作者")
    venue: str = Field("", description="期刊/会议")
    abstract: str = Field("", description="摘要")
    keywords: list[str] = Field(default_factory=list, description="关键词")

    def to_row(self) -> dict:
        return {
            "title": self.title.strip(),
            "year": self.year,
            "authors": self.authors.strip(),
            "venue": self.venue.strip(),
            "abstract": self.abstract.strip(),
            "keywords": ";".join(k.strip() for k in self.keywords if k.strip()),
        }


class ProjectRecord(BaseModel):
    """预留：科研项目/课题主数据（查重、谱系、统计）。存储未启用。"""

    project_id: str = Field(..., min_length=1, description="项目编号")
    title: str = Field(..., description="项目名称")
    leader: str = Field("", description="负责人")
    institution: str = Field("", description="承担单位")
    discipline: str = Field("", description="学科方向")
    batch: str = Field("", description="申报批次/指南")
    amount_wan: float | None = Field(None, description="经费（万元）")
    status: str = Field("", description="状态（申报/在研/结题等）")
    start_year: int | None = Field(None)
    end_year: int | None = Field(None)


class IntegrityRecord(BaseModel):
    """预留：诚信记录（风险提示）。存储未启用。"""

    subject: str = Field(..., description="对象（人员/单位/项目名称或编号）")
    subject_type: str = Field("person", description="person | institution | project")
    record_type: str = Field("", description="失信/违规类型")
    level: str = Field("", description="严重程度，口径待试点校准")
    occurred_at: str = Field("", description="发生/认定时间")
    basis: str = Field("", description="处理依据（文号/制度条款）")
    note: str = Field("", description="备注（对外共享前需脱敏）")


class PolicyMeta(BaseModel):
    """预留：政策版本元数据（按申报时点做版本化合规）。存储未启用。"""

    title: str = Field(..., description="政策名称")
    doc_no: str = Field("", description="文号")
    issuer: str = Field("", description="发布单位")
    version: str = Field("", description="版本")
    valid_from: str = Field("", description="生效日期 YYYY-MM-DD")
    valid_to: str = Field("", description="失效日期 YYYY-MM-DD，空表示现行有效")
    supersedes: str = Field("", description="被本版本替代的文号")
