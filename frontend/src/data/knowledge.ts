export type KnowledgeCategory =
  | "lifecycle"
  | "integrity"
  | "review"
  | "knowledge"
  | "intelligence"
  | "application"
  | "security";

export interface KnowledgeNode {
  id: string;
  name: string;
  category: KnowledgeCategory;
  desc: string;
  source: string;
  props?: Record<string, string>;
}

export interface KnowledgeLink {
  source: string;
  target: string;
  rel: string;
}

export const CATEGORY_META: Record<
  KnowledgeCategory,
  { label: string; short: string; color: string }
> = {
  lifecycle: { label: "科研全周期", short: "周期", color: "#b5853c" },
  integrity: { label: "诚信与合规", short: "诚信", color: "#b85f52" },
  review: { label: "评审与专家", short: "评审", color: "#2d806e" },
  knowledge: { label: "知识与数据", short: "知识", color: "#397d9a" },
  intelligence: { label: "模型与智能体", short: "智能", color: "#98713b" },
  application: { label: "自然资源场景", short: "场景", color: "#56855a" },
  security: { label: "安全与治理", short: "安全", color: "#6d7083" },
};

const node = (
  id: string,
  name: string,
  category: KnowledgeCategory,
  desc: string,
  source: string,
  props?: Record<string, string>,
): KnowledgeNode => ({ id, name, category, desc, source, props });

export const KNOWLEDGE_NODES: KnowledgeNode[] = [
  node("root", "研信智评", "lifecycle", "以科研诚信为约束，把申报、评审、过程管理、成果转化和自然资源业务场景组织为可追溯的科研治理链。", "课题总论", {
    范式: "可信数据 + 规则约束 + 大模型辅助 + 人工复核",
    边界: "不打分、不排名、不替代专家结论",
  }),
  node("intake", "申报受理", "lifecycle", "对申报材料进行解析、登记、形式检查和范围确认，是科研治理链的入口。", "科研全周期", {
    输入: "申报书与附件",
    输出: "标准化申报记录",
  }),
  node("setup", "立项评审", "lifecycle", "组织材料预审、专家评议和人工判断，为立项提供可追溯的辅助依据。", "科研全周期", {
    重点: "形式完整、合规、查重、专家适配",
  }),
  node("process", "过程管理", "lifecycle", "在项目执行阶段持续核对进度、经费、数据安全和诚信约束。", "科研全周期", {
    对象: "项目、团队、任务与成果",
  }),
  node("completion", "结题验收", "lifecycle", "核验考核指标、成果真实性和支撑材料，形成结题审查证据。", "科研全周期", {
    依据: "任务书、成果、政策与人工复核",
  }),
  node("transfer", "成果转化", "lifecycle", "把专利、软件、标准和案例与自然资源业务需求进行匹配。", "科研全周期", {
    目标: "成果可发现、可评价、可对接",
  }),
  node("indicators", "评价指标", "lifecycle", "用可解释指标描述诚信、质量、成效和转化价值，不对项目自动排名。", "治理框架", {
    原则: "规则透明、证据可追溯",
  }),
  node("tiering", "分级管控", "lifecycle", "按风险与材料完整度触发不同层级的人工核查和处置流程。", "治理框架", {
    层级: "提示、关注、人工复核",
  }),

  node("integrity", "科研诚信", "integrity", "贯穿科研全周期的真实性、规范性、责任性和可追溯性要求。", "科研诚信", {
    防线: "制度、数据、模型与人工复核",
  }),
  node("misconduct", "失信行为", "integrity", "违背科研诚信要求的异常行为集合，仅触发风险提示与人工核查。", "科研诚信", {
    原则: "相似不等于抄袭，异常不等于认定",
  }),
  node("misconductAcademic", "学术不端", "integrity", "围绕数据、引用、署名、成果归属等风险形成的科研诚信问题。", "科研诚信", {
    处理: "证据留存与人工判断",
  }),
  node("policyClause", "政策条款", "integrity", "来自公开政策库的规范性依据，以文件、章、条和原文片段回溯。", "政策库", {
    要求: "版本时效须人工核对",
  }),
  node("compliance", "合规审查", "integrity", "将申报内容与政策要求逐项对照，输出检查项和原文依据。", "预审能力", {
    模式: "规则检索 + 可选大模型解释",
  }),
  node("risk", "风险预警", "integrity", "根据证据组合形成风险提示，并明确未覆盖范围与人工复核要求。", "风险治理", {
    边界: "不输出处罚或立项结论",
  }),
  node("credit", "信用分级", "integrity", "以可解释规则归纳申报主体的信用关注程度，辅助管理。", "信用治理", {
    注意: "不替代正式信用认定",
  }),
  node("humanReview", "人工复核", "integrity", "由科研管理人员和评审专家核对模型提示、政策证据与业务事实。", "业务底线", {
    原则: "人在回路",
  }),

  node("formReview", "形式审查", "review", "核对必需章节、元信息和附件的完整性，并保留对应原文。", "预审能力", {
    方式: "规则引擎",
  }),
  node("semanticDuplicate", "语义查重", "review", "同时观察字面重合与语义相近，提示可能重复段落供人工判断。", "查重能力", {
    边界: "主题相似不等于文本重复",
  }),
  node("expertProfile", "专家画像", "review", "以学科、研究方向、成果和可评审状态描述专家能力。", "专家匹配", {
    排除: "不使用性别、年龄等敏感属性",
  }),
  node("expertMatch", "专家匹配", "review", "在硬约束过滤后，结合语义、关键词、学科和负载给出候选专家。", "专家匹配", {
    顺序: "回避与负载先于排序",
  }),
  node("sameInstitution", "同单位回避", "review", "对申报单位与专家单位进行保守排版归一后等值比较。", "回避约束", {
    边界: "简称、别名和上下级关系仍需人工核对",
  }),
  node("avoidPeople", "回避人员", "review", "排除配置中存在人员回避关系的候选专家。", "回避约束", {
    依据: "配置关系等值匹配",
  }),
  node("workload", "负载均衡", "review", "把在研项目与评审负载作为排序约束，避免候选人过度集中。", "专家匹配", {
    阈值: "在研项目达到上限时排除",
  }),

  node("proposal", "申报书", "knowledge", "科研项目申报材料的结构化文本与附件，是问答、预审和查重的主要输入。", "文档库", {
    解析: "DOCX / PDF / TXT / MD",
  }),
  node("policyLibrary", "政策库", "knowledge", "公开政策快照与章条标签构成合规引用和问答检索的依据。", "政策库", {
    来源: "随仓库交付的公开公文",
  }),
  node("paperLibrary", "文献库", "knowledge", "用于趋势分析、相似研究和背景核验的文献元数据与摘要。", "文献数据", {
    输入: "CSV 或文献文档",
  }),
  node("expertLibrary", "专家库", "knowledge", "保存专家专业画像、回避信息和负载状态。", "专家数据", {
    敏感属性: "不采集性别、年龄",
  }),
  node("achievementLibrary", "成果库", "knowledge", "沉淀专利、软件、论文、标准和应用案例等科研成果。", "成果治理", {
    目标: "可追溯与业务匹配",
  }),
  node("knowledgeGraph", "科研知识图谱", "knowledge", "用实体、关系与属性组织科研治理、评审、模型和自然资源场景。", "知识底座", {
    能力: "语义检索、邻接浏览、最短路径",
  }),
  node("rag", "RAG 知识引擎", "knowledge", "先检索文档、政策与图谱证据，再组织答案或审查说明。", "知识底座", {
    原则: "回答与结论都绑定可核对来源",
  }),

  node("llm", "自然资源行业大模型", "intelligence", "面向科研管理和自然资源材料的垂直模型能力入口。", "模型配置", {
    用途: "解释、归纳和辅助文本生成",
  }),
  node("embedding", "向量检索", "intelligence", "以向量语义召回补充关键词与字面检索。", "检索配置", {
    降级: "不可用时回退 TF-IDF",
  }),
  node("evidence", "证据链", "intelligence", "把原文片段、政策条款、图谱关系和模型来源组织为可复核链路。", "产品约束", {
    要求: "来源、状态和人工复核均可见",
  }),
  node("riskAgent", "风险预警 Agent", "intelligence", "聚合材料、政策、查重与主体关系，形成风险提示和核查任务。", "智能体框架", {
    约束: "不自动作出处置结论",
  }),
  node("reviewAgent", "评审辅助 Agent", "intelligence", "围绕预审、专家候选和评审问题生成辅助材料。", "智能体框架", {
    约束: "评分、排名和结论由人负责",
  }),
  node("transferAgent", "成果转化 Agent", "intelligence", "把成果特征与自然资源业务场景进行匹配并提示后续核验。", "智能体框架", {
    边界: "匹配结果须业务确认",
  }),

  node("farmland", "储备补充耕地", "application", "以补定占新机制下，对真实性、在库状态和持续利用情况进行动态监管的对象。", "新申报书", {
    目标: "来源可溯、现状可查、变化可追",
  }),
  node("offsetBalance", "占补平衡", "application", "围绕占用与补充耕地的数量、质量和储备状态形成的管理制度。", "新申报书", {
    机制: "以补定占",
  }),
  node("projectCellTarget", "项目—地块—指标", "application", "把占补项目、空间地块和补充耕地指标建立三级关联。", "新申报书", {
    作用: "跨阶段追溯与统一查询",
  }),
  node("remoteSensing", "多时序遥感", "application", "用近十年多期高分影像识别地块状态和异常变化。", "新申报书", {
    处理: "变化检测、季节伪变化抑制",
  }),
  node("landState", "耕地状态识别", "application", "识别持续耕种、休耕、非农化、非粮化和撂荒等状态。", "新申报书", {
    目标: "地块尺度真实性判别",
  }),
  node("sampleGenealogy", "谱系化样本", "application", "按江苏六大典型地貌区组织样本，并用于迁移学习和领域自适应。", "新申报书", {
    目的: "提升省域泛化能力",
  }),
  node("humanMachineCheck", "人机协同核查", "application", "将模型初筛、置信度分级、人工判读和结果反馈组成核查流程。", "新申报书", {
    流程: "发现—预警—处置",
  }),
  node("oversightLoop", "监管闭环", "application", "把监管发现、核查反馈和模型迭代连成持续改进闭环。", "新申报书", {
    目标: "机器初筛、人工精判、持续迭代",
  }),

  node("intranetDeployment", "内网部署", "security", "模型、数据和评审材料默认在受控网络内运行。", "安全边界", {
    公网访问: "须显式授权",
  }),
  node("rbac", "权限分级", "security", "按管理员、科研管理、评审专家和访客限制功能与数据访问。", "权限矩阵", {
    服务端: "二次强制校验",
  }),
  node("auditTrace", "审计追溯", "security", "记录关键读取、分析、生成和人工操作来源，支持事后复核。", "安全治理", {
    对象: "证据、模型来源与操作状态",
  }),
  node("dataMasking", "数据脱敏", "security", "对敏感字段、访问范围和对外共享进行分级控制。", "数据治理", {
    原则: "最小必要",
  }),
];

const link = (source: string, target: string, rel: string): KnowledgeLink => ({ source, target, rel });

export const KNOWLEDGE_LINKS: KnowledgeLink[] = [
  link("root", "process", "贯穿"),
  link("root", "proposal", "接收"),
  link("root", "integrity", "以诚信为约束"),
  link("root", "setup", "组织"),
  link("root", "policyClause", "引用"),
  link("root", "expertMatch", "辅助"),
  link("root", "knowledgeGraph", "构建"),
  link("root", "rag", "调用"),
  link("root", "farmland", "落地场景"),
  link("root", "intranetDeployment", "部署于"),
  link("root", "auditTrace", "要求"),
  link("intake", "proposal", "接收"),
  link("intake", "formReview", "触发"),
  link("setup", "expertMatch", "调用"),
  link("process", "compliance", "持续检查"),
  link("completion", "evidence", "形成"),
  link("transfer", "achievementLibrary", "沉淀"),
  link("transfer", "transferAgent", "辅助匹配"),
  link("indicators", "credit", "支撑"),
  link("tiering", "risk", "承接"),
  link("integrity", "compliance", "要求"),
  link("integrity", "misconduct", "约束"),
  link("integrity", "credit", "形成"),
  link("integrity", "risk", "触发"),
  link("misconduct", "misconductAcademic", "包含"),
  link("misconduct", "policyClause", "依据"),
  link("misconduct", "humanReview", "提交"),
  link("policyClause", "policyLibrary", "来自"),
  link("policyClause", "compliance", "支撑"),
  link("risk", "riskAgent", "调用"),
  link("credit", "tiering", "参与"),
  link("humanReview", "evidence", "核对"),
  link("formReview", "proposal", "检查"),
  link("formReview", "compliance", "联合"),
  link("semanticDuplicate", "paperLibrary", "比对"),
  link("semanticDuplicate", "embedding", "可选用"),
  link("semanticDuplicate", "humanReview", "提交"),
  link("expertProfile", "expertLibrary", "来自"),
  link("expertMatch", "expertProfile", "使用"),
  link("expertMatch", "workload", "受限于"),
  link("expertMatch", "sameInstitution", "受限于"),
  link("expertMatch", "avoidPeople", "受限于"),
  link("expertMatch", "indicators", "形成理由"),
  link("sameInstitution", "policyClause", "遵循"),
  link("avoidPeople", "expertLibrary", "读取"),
  link("workload", "expertProfile", "更新"),
  link("proposal", "policyLibrary", "对照"),
  link("proposal", "paperLibrary", "查重参考"),
  link("proposal", "evidence", "产生"),
  link("policyLibrary", "rag", "进入检索"),
  link("paperLibrary", "rag", "进入检索"),
  link("expertLibrary", "rag", "进入检索"),
  link("achievementLibrary", "transfer", "支撑"),
  link("knowledgeGraph", "rag", "提供子图"),
  link("knowledgeGraph", "evidence", "组织关系"),
  link("rag", "llm", "装配上下文"),
  link("rag", "embedding", "语义召回"),
  link("llm", "reviewAgent", "驱动"),
  link("llm", "transferAgent", "驱动"),
  link("llm", "evidence", "生成须绑定"),
  link("embedding", "paperLibrary", "索引"),
  link("embedding", "knowledgeGraph", "可嵌入实体"),
  link("evidence", "humanReview", "交付"),
  link("riskAgent", "risk", "生成提示"),
  link("riskAgent", "evidence", "绑定"),
  link("reviewAgent", "expertMatch", "解释候选"),
  link("reviewAgent", "evidence", "绑定"),
  link("transferAgent", "transfer", "辅助"),
  link("transferAgent", "achievementLibrary", "读取"),
  link("transferAgent", "indicators", "参考"),
  link("farmland", "offsetBalance", "属于"),
  link("farmland", "projectCellTarget", "建立底账"),
  link("farmland", "remoteSensing", "持续观测"),
  link("farmland", "landState", "识别状态"),
  link("farmland", "oversightLoop", "纳入监管"),
  link("offsetBalance", "policyClause", "依据"),
  link("projectCellTarget", "knowledgeGraph", "形成时空图谱"),
  link("projectCellTarget", "integrity", "支撑真实性核验"),
  link("remoteSensing", "landState", "输入模型"),
  link("remoteSensing", "knowledgeGraph", "关联场景"),
  link("landState", "sampleGenealogy", "训练使用"),
  link("sampleGenealogy", "embedding", "可编码"),
  link("landState", "humanMachineCheck", "提交核查"),
  link("humanMachineCheck", "oversightLoop", "形成闭环"),
  link("oversightLoop", "riskAgent", "产生预警"),
  link("humanMachineCheck", "reviewAgent", "辅助研判"),
  link("oversightLoop", "auditTrace", "记录证据"),
  link("intranetDeployment", "rbac", "执行"),
  link("intranetDeployment", "dataMasking", "执行"),
  link("intranetDeployment", "llm", "托管模型"),
  link("rbac", "auditTrace", "记录访问"),
  link("rbac", "compliance", "约束操作"),
  link("rbac", "humanReview", "限定角色"),
  link("dataMasking", "achievementLibrary", "保护成果"),
  link("dataMasking", "policyLibrary", "控制共享"),
  link("dataMasking", "embedding", "约束外发"),
  link("auditTrace", "evidence", "记录来源"),
  link("auditTrace", "oversightLoop", "留痕"),
  link("auditTrace", "riskAgent", "记录提示"),
  link("integrity", "humanReview", "最终由人确认"),
];

export function validateKnowledgeGraph() {
  const ids = new Set(KNOWLEDGE_NODES.map((item) => item.id));
  if (ids.size !== KNOWLEDGE_NODES.length) throw new Error("知识图谱实体 ID 重复");
  if (KNOWLEDGE_NODES.length !== 48) throw new Error("知识图谱实体数必须是 48");
  if (KNOWLEDGE_LINKS.length !== 100) throw new Error("知识图谱关系数必须是 100");
  const categories = Object.keys(CATEGORY_META) as KnowledgeCategory[];
  if (categories.every((category) => KNOWLEDGE_NODES.some((item) => item.category === category)) === false) {
    throw new Error("知识图谱知识域不完整");
  }
  const expectedCounts: Record<KnowledgeCategory, number> = {
    lifecycle: 8,
    integrity: 8,
    review: 7,
    knowledge: 7,
    intelligence: 6,
    application: 8,
    security: 4,
  };
  for (const category of categories) {
    const count = KNOWLEDGE_NODES.filter((item) => item.category === category).length;
    if (count !== expectedCounts[category]) throw new Error(`知识域 ${category} 实体数错误`);
  }
  const connected = new Set<string>();
  const edges = new Set<string>();
  for (const relation of KNOWLEDGE_LINKS) {
    if (!ids.has(relation.source) || !ids.has(relation.target)) {
      throw new Error(`知识图谱关系端点不存在：${relation.source} -> ${relation.target}`);
    }
    const edge = `${relation.source}|${relation.target}|${relation.rel}`;
    if (edges.has(edge)) throw new Error(`知识图谱关系重复：${edge}`);
    edges.add(edge);
    if (relation.source === relation.target) {
      throw new Error(`知识图谱不允许自环：${relation.source}`);
    }
    connected.add(relation.source);
    connected.add(relation.target);
  }
  if (connected.size !== KNOWLEDGE_NODES.length) throw new Error("知识图谱存在孤立实体");
}

validateKnowledgeGraph();

export const GRAPH_STATS = {
  nodes: KNOWLEDGE_NODES.length,
  links: KNOWLEDGE_LINKS.length,
  categories: Object.keys(CATEGORY_META).length,
  sources: new Set(KNOWLEDGE_NODES.map((item) => item.source)).size,
};

export const PATH_OPTIONS = [
  "root",
  "proposal",
  "policyClause",
  "semanticDuplicate",
  "expertMatch",
  "humanReview",
  "knowledgeGraph",
  "rag",
  "riskAgent",
  "farmland",
  "projectCellTarget",
  "remoteSensing",
  "oversightLoop",
  "intranetDeployment",
];

const nodeMap = new Map(KNOWLEDGE_NODES.map((item) => [item.id, item]));
const adjacency = new Map<string, string[]>();

for (const item of KNOWLEDGE_NODES) adjacency.set(item.id, []);
for (const relation of KNOWLEDGE_LINKS) {
  adjacency.get(relation.source)?.push(relation.target);
  adjacency.get(relation.target)?.push(relation.source);
}

export function getNode(id: string): KnowledgeNode | undefined {
  return nodeMap.get(id);
}

export function getNeighbors(id: string) {
  const out: { node: KnowledgeNode; rel: string; direction: "out" | "in" }[] = [];
  for (const relation of KNOWLEDGE_LINKS) {
    if (relation.source === id) {
      const target = getNode(relation.target);
      if (target) out.push({ node: target, rel: relation.rel, direction: "out" });
    } else if (relation.target === id) {
      const source = getNode(relation.source);
      if (source) out.push({ node: source, rel: relation.rel, direction: "in" });
    }
  }
  return out;
}

export function findShortestPath(from: string, to: string): KnowledgeNode[] | null {
  if (from === to) {
    const direct = getNode(from);
    return direct ? [direct] : null;
  }
  const queue: string[][] = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      const nextPath = [...path, next];
      if (next === to) {
        return nextPath.map((id) => getNode(id)).filter((item): item is KnowledgeNode => Boolean(item));
      }
      seen.add(next);
      queue.push(nextPath);
    }
  }
  return null;
}
