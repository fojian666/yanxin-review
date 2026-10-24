from __future__ import annotations

import logging
import secrets
import shutil
from pathlib import Path

from . import auth, config, db
from .parsers import parse_upload
from .text import chunk_document, extract_keywords, extract_year, guess_title

logger = logging.getLogger("uvicorn.error")


def _demo_password() -> tuple[str, bool]:
    if config.DEMO_USER_PASSWORD:
        return config.DEMO_USER_PASSWORD, False
    if config.is_loopback():
        return "yanxin2026", False
    return secrets.token_urlsafe(12), True


def seed_demo_users() -> int:
    """演示账号；非本机监听时默认不创建，避免默认口令暴露。"""
    if not config.SEED_DEMO_USERS:
        logger.warning(
            "已跳过演示账号种子：监听地址 %s 非本机，且未显式设置 SEED_DEMO_USERS=1。",
            config.BIND_HOST,
        )
        return 0
    if _seeded("users"):
        return 0
    if auth.list_users():
        _mark_seeded("users")
        return 0
    password, generated = _demo_password()
    if len(password) < auth.MIN_PASSWORD_LEN:
        logger.error(
            "DEMO_USER_PASSWORD 少于 %d 位，已跳过演示账号种子。",
            auth.MIN_PASSWORD_LEN,
        )
        return 0
    inserted = 0
    for username, role in (
        ("admin", "admin"),
        ("manager", "manager"),
        ("reviewer", "reviewer"),
        ("viewer", "viewer"),
    ):
        if auth.create_user(
            username, password, role, auth.ROLE_LABELS[role]
        ):
            inserted += 1
    _mark_seeded("users")
    if generated:
        logger.warning(
            "非本机监听且未设置 DEMO_USER_PASSWORD，已生成随机演示密码：%s"
            "（仅显示一次，请立即记录并改密）",
            password,
        )
    return inserted

_PAPER_ROWS = [
    (2019, "科研诚信治理的政策工具与实施路径研究", "科研诚信;科技政策"),
    (2019, "自然资源科研项目全周期监管框架初探", "自然资源;项目管理"),
    (2019, "基于文本比对的学术不端检测方法综述", "学术不端;文本比对"),
    (2019, "科研评审专家遴选的规范化研究", "专家评审;科研管理"),
    (2020, "科研诚信评价指标体系构建与实证", "科研诚信;评价指标"),
    (2020, "语义相似度计算在论文查重中的应用", "语义查重;文本挖掘"),
    (2020, "自然资源领域知识图谱构建方法研究", "知识图谱;自然资源"),
    (2020, "科研项目风险预警的数据治理路径", "风险预警;数据治理"),
    (2020, "学术不端行为的演化特征与治理对策", "学术不端;科研诚信"),
    (2021, "多源数据融合的科研诚信档案构建", "科研诚信;数据融合"),
    (2021, "基于表示学习的跨语言语义查重研究", "语义查重;跨语言"),
    (2021, "科研管理知识图谱的实体消歧方法", "知识图谱;实体消歧"),
    (2021, "专家评审意见质量的影响因素分析", "专家评审;评审质量"),
    (2021, "自然资源科技成果转化机制研究", "成果转化;自然资源"),
    (2022, "科研诚信风险分级评价模型研究", "科研诚信;风险分级"),
    (2022, "预训练语言模型在学术文本比对中的应用", "大模型;语义查重"),
    (2022, "面向科研管理的知识图谱问答系统", "知识图谱;问答系统"),
    (2022, "科研项目重复申报的识别方法", "重复申报;科研诚信"),
    (2022, "专家画像驱动的评审专家推荐研究", "专家评审;专家画像"),
    (2022, "科研数据安全治理框架研究", "数据安全;数据治理"),
    (2023, "大语言模型辅助科研诚信审查的可行性研究", "大模型;科研诚信"),
    (2023, "检索增强生成在政策问答中的应用", "RAG;政策问答"),
    (2023, "基于图神经网络的学术不端团伙识别", "知识图谱;学术不端"),
    (2023, "科研项目全周期风险预警指标体系", "风险预警;项目管理"),
    (2023, "多模态科研成果结构化归集方法", "多模态;成果管理"),
    (2023, "专家评审中的利益冲突识别与回避", "专家评审;利益冲突"),
    (2023, "自然资源科研数据治理与共享机制", "数据治理;自然资源"),
    (2024, "大模型驱动的科研项目智能受理研究", "大模型;智能受理"),
    (2024, "RAG 增强的科研政策合规审查方法", "RAG;合规审查"),
    (2024, "科研诚信知识图谱构建与推理", "知识图谱;科研诚信"),
    (2024, "生成式人工智能的学术伦理风险与治理", "生成式人工智能;学术伦理"),
    (2024, "语义查重中的改写识别与证据链构建", "语义查重;证据链"),
    (2024, "科研评审智能体协同框架研究", "智能体;专家评审"),
    (2024, "科技成果与业务场景的语义匹配", "成果转化;语义匹配"),
    (2024, "科研管理数据中台建设实践", "数据治理;科研管理"),
    (2025, "垂直领域大模型在科研诚信治理中的应用", "大模型;科研诚信"),
    (2025, "多智能体协同的科研全周期监管", "智能体;全周期管理"),
    (2025, "时间感知 RAG 的政策版本问答研究", "RAG;政策问答"),
    (2025, "大模型辅助评审的可解释性与公平性", "大模型;专家评审"),
    (2025, "多模态成果转化匹配与价值评估", "多模态;成果转化"),
    (2025, "科研诚信风险预警的知识增强方法", "知识图谱;风险预警"),
    (2025, "自然资源科研治理的数字化转型路径", "自然资源;数字治理"),
]

_METHODS = [
    "政策文本分析", "案例研究", "文本挖掘", "知识图谱建模", "问卷调查",
    "对比实验", "系统设计", "实证分析", "专家访谈", "原型验证",
]
_FINDINGS = [
    "现有研究在概念界定和指标可操作性上仍有提升空间",
    "语义方法与规则方法结合能提升识别精度",
    "跨部门数据共享是治理落地的关键约束",
    "大模型可降低人工审查成本，但证据溯源不可缺失",
    "专家匹配需要在专业匹配与回避约束之间取得平衡",
    "成果转化匹配应同时考虑技术相关性与业务场景需求",
    "时间维度的政策版本管理是合规审查的薄弱环节",
    "多模态成果的结构化归集仍缺乏统一标准",
    "风险预警指标需要与科研流程节点建立对应关系",
    "智能体协同可以提升全周期监管的自动化水平",
]


def _abstract(year: int, title: str, keywords: str, idx: int) -> str:
    kws = [k.strip() for k in keywords.replace("；", ";").split(";") if k.strip()]
    a = kws[0] if kws else "科研管理"
    b = kws[1] if len(kws) > 1 else "自然资源"
    method = _METHODS[idx % len(_METHODS)]
    finding = _FINDINGS[idx % len(_FINDINGS)]
    return (
        f"围绕{title}，本文采用{method}，梳理{year}年前后的研究与实践进展，"
        f"分析{a}与{b}之间的关系。研究发现，{finding}。"
        f"研究可为自然资源科研全周期治理、诚信风险防控与评审管理提供参考。"
    )


def _seeded(key: str) -> bool:
    """种子标记存放在数据库 meta 表中，与库同生命周期；
    旧的文件标记（.seeded_*）只读取迁移，避免删库后标记残留导致不再播种。"""
    if db.get_meta(f"seeded_{key}"):
        return True
    legacy = config.DATA_DIR / f".seeded_{key}"
    if legacy.exists():
        db.set_meta(f"seeded_{key}", "seeded")
        return True
    return False


def _mark_seeded(key: str) -> None:
    db.set_meta(f"seeded_{key}", "seeded")


def seed_demo_papers() -> int:
    if not config.SEED_DEMO_PAPERS:
        return 0
    if _seeded("papers"):
        return 0
    inserted = 0
    for idx, (year, title, keywords) in enumerate(_PAPER_ROWS):
        db.insert_paper(
            {
                "title": title,
                "authors": "示例作者",
                "year": year,
                "venue": "示例期刊",
                "abstract": _abstract(year, title, keywords, idx),
                "keywords": keywords,
                "is_sample": 1,
                "source": "demo",
            }
        )
        inserted += 1
    _mark_seeded("papers")
    return inserted


def seed_sample_document() -> bool:
    if not config.SEED_SAMPLE_DOC:
        return False
    if _seeded("doc"):
        return False
    if not config.SAMPLE_DOCX.exists():
        return False
    if db.list_documents():
        _mark_seeded("doc")
        return False
    logger.warning(
        "SEED_SAMPLE_DOC=1：将把本地真实申请书 %s 复制入库（含个人信息），"
        "仅限本机演示；请勿在对外环境开启。",
        config.SAMPLE_DOCX.name,
    )
    target = config.UPLOAD_DIR / "sample_proposal.docx"
    shutil.copyfile(config.SAMPLE_DOCX, target)
    try:
        parsed = parse_upload(target)
        pages = parsed["pages"]
        chunks = chunk_document(pages, chunk_size=config.CHUNK_SIZE, overlap=config.CHUNK_OVERLAP)
        title = guess_title(config.SAMPLE_DOCX.name, pages[0]["text"] if pages else "")
        doc = {
            "id": db.new_id(),
            "name": f"示例本子：{title}",
            "kind": "proposal",
            "year": extract_year(config.SAMPLE_DOCX.name, pages[0]["text"] if pages else "") or 2026,
            "source": "seed",
            "path": str(target),
            "text_len": parsed["text_len"],
            "page_count": parsed["page_count"],
            "warning": parsed.get("warning", ""),
            "meta": {"seeded": True, "original": config.SAMPLE_DOCX.name},
        }
        db.insert_document(doc, chunks)
        _mark_seeded("doc")
        return True
    except Exception:
        # 解析失败也标记，避免每次启动重复尝试损坏文件
        _mark_seeded("doc")
        return False




_EXPERTS = [
    {
        "name": "示例专家A", "institution": "示例大学A", "title": "教授",
        "discipline": "科研管理 / 科技政策",
        "research_areas": "科研诚信;科技政策;科研管理;评价体系",
        "achievements": "主持科研诚信治理与科技评价相关课题（示例数据）",
        "avoid_institutions": "示例大学B", "workload": 1, "available": True,
    },
    {
        "name": "示例专家B", "institution": "示例大学B", "title": "教授",
        "discipline": "计算机科学 / 文本挖掘",
        "research_areas": "语义查重;文本挖掘;自然语言处理;学术不端检测",
        "achievements": "发表文本相似度与学术不端检测方向论文（示例数据）",
        "avoid_institutions": "", "workload": 2, "available": True,
    },
    {
        "name": "示例专家C", "institution": "示例研究院C", "title": "研究员",
        "discipline": "地理信息 / 自然资源",
        "research_areas": "知识图谱;自然资源;国土空间;数据治理",
        "achievements": "承担自然资源知识图谱与数据治理项目（示例数据）",
        "avoid_institutions": "示例大学A", "workload": 0, "available": True,
    },
    {
        "name": "示例专家D", "institution": "示例大学D", "title": "教授",
        "discipline": "人工智能 / 大模型",
        "research_areas": "大模型;检索增强;RAG;智能体;可解释性",
        "achievements": "研究大模型在垂直领域的应用与评测（示例数据）",
        "avoid_institutions": "", "workload": 3, "available": True,
    },
    {
        "name": "示例专家E", "institution": "示例研究院E", "title": "研究员",
        "discipline": "科研管理 / 评审管理",
        "research_areas": "专家评审;专家画像;科研管理;利益冲突",
        "achievements": "参与科研项目评审与专家管理机制研究（示例数据）",
        "avoid_institutions": "", "workload": 1, "available": True,
    },
    {
        "name": "示例专家F", "institution": "示例大学F", "title": "教授",
        "discipline": "信息安全 / 数据治理",
        "research_areas": "数据安全;隐私计算;数据治理;合规审查",
        "achievements": "研究科研数据安全与合规治理（示例数据）",
        "avoid_institutions": "", "workload": 2, "available": True,
    },
    {
        "name": "示例专家G", "institution": "示例中心G", "title": "高级工程师",
        "discipline": "技术转移 / 成果转化",
        "research_areas": "成果转化;技术转移;价值评估;产学研合作",
        "achievements": "从事科技成果转化与价值评估实践（示例数据）",
        "avoid_institutions": "", "workload": 0, "available": True,
    },
    {
        "name": "示例专家H", "institution": "示例研究院H", "title": "研究员",
        "discipline": "测绘 / 自然资源信息化",
        "research_areas": "自然资源;GIS;一张图;科研信息化;项目管理",
        "achievements": "参与自然资源信息化与一张图建设（示例数据）",
        "avoid_institutions": "", "workload": 1, "available": True,
    },
    {
        "name": "示例专家I", "institution": "示例大学I", "title": "教授",
        "discipline": "科研伦理 / 学术规范",
        "research_areas": "科研诚信;学术不端;科研伦理;学术规范",
        "achievements": "从事科研伦理与学术规范研究（示例数据）",
        "avoid_institutions": "", "workload": 4, "available": True,
    },
    {
        "name": "示例专家J", "institution": "示例大学J", "title": "教授",
        "discipline": "文档智能 / 多模态",
        "research_areas": "多模态;文档智能;信息抽取;知识图谱",
        "achievements": "研究多模态文档理解与信息抽取（示例数据）",
        "avoid_institutions": "", "workload": 2, "available": True,
    },
    {
        "name": "示例专家K", "institution": "示例研究院K", "title": "研究员",
        "discipline": "信用评价 / 风险预警",
        "research_areas": "风险预警;信用评价;指标体系;风险分级",
        "achievements": "研究科研信用评价与风险预警模型（示例数据）",
        "avoid_institutions": "", "workload": 5, "available": True,
    },
    {
        "name": "示例专家L", "institution": "示例大学L", "title": "副教授",
        "discipline": "智能体 / 多智能体系统",
        "research_areas": "智能体;多智能体;协同调度;大模型",
        "achievements": "研究多智能体协同与任务调度（示例数据）",
        "avoid_institutions": "", "workload": 1, "available": False,
    },
]


def seed_demo_experts() -> int:
    if _seeded("experts"):
        return 0
    inserted = 0
    for expert in _EXPERTS:
        db.insert_expert({**expert, "is_sample": 1, "source": "demo"})
        inserted += 1
    _mark_seeded("experts")
    return inserted


def seed_all() -> dict:
    return {
        "papers": seed_demo_papers(),
        "sample_doc": seed_sample_document(),
        "experts": seed_demo_experts(),
        "users": seed_demo_users(),
    }
