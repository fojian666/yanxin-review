import type { DossierPhase } from "../types";

export interface ProposalWorkflowStage {
  key: string;
  label: string;
  summary: string;
  materials: string[];
  phase?: DossierPhase;
}

export const PROPOSAL_WORKFLOW: ProposalWorkflowStage[] = [
  {
    key: "guide",
    label: "指南发布",
    summary: "发布通知与指南，申报单位下载申请书、诚信承诺书等模板。",
    materials: ["通知与指南", "申请书模板", "诚信承诺书模板"],
  },
  {
    key: "application",
    label: "立项申请",
    summary: "在线填报课题信息，上传盖章申请书和诚信承诺书，并由地方主管部门审核推荐。",
    materials: ["申请书", "盖章扫描件", "诚信承诺书", "主管部门信息"],
    phase: "application",
  },
  {
    key: "review",
    label: "立项评审",
    summary: "科技处检查材料完整性，分类抽选专家评审，并对拟立项课题公示。",
    materials: ["完整申报包", "专家评审记录", "公示材料"],
  },
  {
    key: "implementation",
    label: "课题实施",
    summary: "指令性课题签合同，指导性课题签实施承诺；过程调整、延期和终止在线办理。",
    materials: ["课题合同", "实施承诺书", "阶段进展与变更材料"],
    phase: "implementation",
  },
  {
    key: "acceptance",
    label: "课题验收",
    summary: "提交验收申请、绩效自评、财务决算和成果材料，组织专家评价。",
    materials: ["验收申请", "绩效自评", "财务决算", "成果报告", "科技咨政建议", "专家意见"],
    phase: "acceptance",
  },
  {
    key: "closing",
    label: "备案结题",
    summary: "验收后十个工作日内提交完善成果、验收意见及结题备案材料。",
    materials: ["结题备案材料", "修订成果", "验收相关材料"],
    phase: "closing",
  },
];

export function currentWorkflowIndex(phase: DossierPhase): number {
  return Math.max(
    0,
    PROPOSAL_WORKFLOW.findIndex((stage) => stage.phase === phase)
  );
}
