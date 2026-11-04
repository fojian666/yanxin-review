export type UserRole = "admin" | "manager" | "reviewer" | "viewer";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  manager: "科研管理",
  reviewer: "评审专家",
  viewer: "访客",
};

export interface AuthUser {
  username: string;
  role: UserRole;
  display_name: string;
}

export interface LlmStatus {
  configured: boolean;
  provider: string;
  label: string;
  model: string;
  base_url: string;
}

export interface Health {
  ok: boolean;
  demo_login?: boolean;
  llm: LlmStatus;
  stats: {
    documents: number;
    chunks: number;
    papers: number;
    sample_papers: number;
    experts?: number;
    sample_experts?: number;
  };
  retriever_ready: boolean;
  upload_limit_mb?: number;
  upload_types?: { suffix: string; label: string }[];
  retrieval?: {
    mode: "tfidf" | "embedding";
    model: string;
    chunks: number;
  };
}

export interface DocItem {
  can_check?: boolean;
  id: string;
  name: string;
  kind: string;
  year: number | null;
  source: string;
  text_len: number;
  page_count: number;
  chunk_count: number;
  status: string;
  warning: string | null;
  created_at: string;
}

export interface DocumentChunk {
  idx: number;
  page: number | null;
  section: string;
  text: string;
  char_len: number;
}

export interface DocumentContent {
  document: DocItem;
  chunks: DocumentChunk[];
}

export interface DocumentAccessPolicy {
  owner_username: string;
  visibility: "restricted" | "public";
  readers: string[];
}

export interface DocumentAccessEvent {
  actor: string;
  action: string;
  created_at: string;
}

export interface Citation {
  index: number;
  doc_id: string;
  doc_name: string;
  page: number | null;
  section: string;
  score: number;
  text: string;
}

export type Role = "user" | "assistant";

export type ChatStrength = "default" | "quick" | "low" | "high" | "max";
export interface ChatSelection { model: string; strength: ChatStrength }
export interface ChatModelOption {
  id: string;
  label: string;
  model: string;
  available: boolean;
  reason: string;
  strengths: ChatStrength[];
}

export interface GenerationInfo {
  provider: string;
  label: string;
  model: string;
  status: "complete" | "fallback" | "interrupted";
  strength?: ChatStrength;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  time?: string;
  citations?: Citation[];
  warning?: string;
  error?: string;
  streaming?: boolean;
  generation?: GenerationInfo;
}

export interface TrendSeries {
  name: string;
  values: number[];
}

export interface TrendPaper {
  id: number;
  title: string;
  year: number;
  authors: string;
  venue: string;
  keywords: string;
  abstract: string;
  relevance: number;
  is_sample: boolean;
}

export interface TrendStats {
  total: number;
  year_start: number;
  year_end: number;
  top_keyword: string;
  growth_pct: number | null;
  first_year_count: number;
  last_year_count: number;
  sample_count: number;
  real_count: number;
}

export interface TrendData {
  query: string;
  years: number[];
  counts: number[];
  keyword_series: TrendSeries[];
  top_keywords_by_year: { year: number; keywords: { name: string; count: number }[] }[];
  papers: TrendPaper[];
  summary: string;
  mode: string;
  warning: string;
  sample: boolean;
  no_match: boolean;
  stats: TrendStats;
}

export type CheckStatus = "pass" | "warn" | "fail";

export type DossierPlanType = "directive" | "guidance";
export type DossierPhase = "application" | "implementation" | "acceptance" | "closing";

export interface DossierMaterial {
  dossier_id: string;
  doc_id: string;
  doc_name: string;
  doc_kind: string;
  doc_status: string;
  doc_warning: string | null;
  doc_suffix: string;
  role: string;
  version: number;
  is_current: boolean;
  human_verified: boolean;
  verified_by: string;
  verified_at: string | null;
  created_at: string;
}

export interface Dossier {
  id: string;
  name: string;
  year: number | null;
  plan_type: DossierPlanType;
  plan_type_label: string;
  phase: DossierPhase;
  phase_label: string;
  applicant_unit: string;
  leader: string;
  supervisor: string;
  materials: DossierMaterial[];
  current_material_count: number;
  verified_material_count: number;
  created_at: string;
  updated_at: string;
}

export interface DossierOption {
  value: string;
  label: string;
  short?: string;
  requires_verification?: boolean;
}

export interface DossierOptions {
  plan_types: DossierOption[];
  phases: DossierOption[];
  material_roles: DossierOption[];
}

export interface DossierChecklistItem extends ReviewItem {
  key: string;
  role: string;
  doc_id: string;
  requires_human_verification: boolean;
}

export interface DossierChecklistSection {
  key: string;
  title: string;
  status: CheckStatus;
  items: DossierChecklistItem[];
}

export interface DossierChecklist {
  dossier: Dossier;
  overall: {
    status: CheckStatus;
    summary: string;
    checked_items: number;
    generated_at: string;
  };
  sections: DossierChecklistSection[];
  limitations: string[];
  disclaimer: string;
}

export interface ReviewItem {
  label: string;
  status: CheckStatus;
  detail: string;
  evidence: string;
  /** 政策条款全文（evidence 为短摘要，供「展开全文」用） */
  evidence_full?: string;
  /** 系统证据对应的文档，可直接回到文档中心 */
  source_doc_id?: string;
}

export interface ReviewSection {
  key: string;
  title: string;
  status: CheckStatus;
  items: ReviewItem[];
}

export interface ReviewMatch {
  matched_doc_id: string;
  matched_doc_name: string;
  similarity: number;
  source_snippet: string;
  matched_snippet: string;
  restricted?: boolean;
  reference_id?: string;
}

export interface ReviewReport {
  access_note?: string;
  doc: {
    id: string;
    name: string;
    kind: string;
    year: number | null;
    char_count: number;
    chunk_count: number;
  };
  overall: {
    summary: string;
    risk_level: string;
    checked_items: number;
    generated_at: string;
  };
  sections: ReviewSection[];
  duplicate: { matches: ReviewMatch[] };
  questions: string[];
  mode: string;
  generation?: GenerationInfo;
  warning: string;
  /** 未启用大模型时的能力边界说明，空数组表示由模型生成 */
  limitations?: string[];
  disclaimer: string;
}

export interface Paper {
  id: number;
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  abstract: string;
  keywords: string;
  keywords_list: string[];
  is_sample: number;
  source: string;
}

export interface ChatHistoryItem {
  role: Role;
  content: string;
}

export interface StreamHandlers {
  onMeta: (payload: { citations: Citation[]; mode: string; warning: string }) => void;
  onGeneration?: (generation: GenerationInfo) => void;
  onToken: (text: string) => void;
  onWarning: (message: string) => void;
  onDone: (generation?: GenerationInfo) => void;
}


export interface Expert {
  id: number;
  name: string;
  institution: string;
  title: string;
  discipline: string;
  research_areas: string;
  achievements: string;
  avoid_institutions: string;
  avoid_people: string;
  workload: number;
  available: number;
  is_sample: number;
  source: string;
  created_at: string;
}

export interface ExpertCandidate {
  expert: Expert;
  score: number;
  relative_score?: number;
  semantic: number;
  keyword_score: number;
  discipline_match: number;
  reasons: string[];
}

export interface ExcludedExpert {
  evidence: string;
  name: string;
  institution: string;
  reason: string;
}

export interface ExpertMatchResult {
  applicant_detected: boolean;
  applicant_warning: string;
  institution_match_note: string;
  doc: { id: string; name: string };
  proposal_keywords: string[];
  applicant: { institutions: string[]; people: string[] };
  candidates: ExpertCandidate[];
  excluded: ExcludedExpert[];
  total_experts: number;
  available_count: number;
  summary: string;
  disclaimer: string;
}

export interface DuplicateMatch {
  matched_doc_id: string;
  matched_doc_name: string;
  similarity: number;
  source_snippet: string;
  matched_snippet: string;
  restricted?: boolean;
  reference_id?: string;
}

export interface DuplicateResult {
  access_note?: string;
  matches: DuplicateMatch[];
  highest: number;
  high_count: number;
  watch_count: number;
  summary: string;
}

export interface ToolCheckResult {
  doc: { id: string; name: string; kind: string; year: number | null };
  duplicate: DuplicateResult;
  match: ExpertMatchResult;
  generated_at: string;
  disclaimer: string;
}

export type ReviewCaseStage = "pre_review" | "expert_review" | "final_review" | "completed";
export type ReviewTaskStatus = "assigned" | "submitted" | "conflict";
export type ReviewDecision = "approved" | "returned" | "deferred" | "rejected";
export type ExpertRecommendation = "approve" | "revise" | "reject";

export interface ReviewArtifact {
  redacted?: boolean;
  original_sha256?: string;
  id: string;
  case_id: string;
  flow_id?: string;
  stage: ReviewCaseStage;
  stage_label: string;
  artifact_type: "pre_review" | "tool_check" | "expert_assignment" | "expert_opinion" | "expert_conflict" | "final_decision";
  title: string;
  round?: number;
  format: "markdown";
  content: string;
  payload: Record<string, unknown>;
  source_doc_id: string;
  created_by: string;
  created_at: string;
  sha256: string;
  case_title?: string;
  doc_name?: string;
}

export interface ReviewTask {
  id: string;
  case_id: string;
  assignee_username: string;
  expert_id: number | null;
  expert_name: string;
  expert_institution: string;
  expert_title: string;
  status: ReviewTaskStatus;
  status_label: string;
  conflict_declared: boolean;
  conflict_reason: string;
  recommendation: ExpertRecommendation | null;
  recommendation_label?: string;
  opinion: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  case_title?: string;
  case_stage?: ReviewCaseStage;
  case_status?: string;
  doc_id?: string;
  doc_name?: string;
  doc_kind?: string;
  doc_warning?: string | null;
  round?: number;
  admin_debug?: boolean;
  submitted_by?: string;
  pre_review?: ReviewArtifact | null;
  tool_check?: ReviewArtifact | null;
}

export interface ReviewAction {
  id: number;
  case_id: string;
  task_id: string | null;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ReviewCase {
  id: string;
  title: string;
  dossier_id: string | null;
  doc_id: string;
  doc_name: string;
  doc_kind: string;
  doc_year: number | null;
  doc_text_len: number;
  doc_chunk_count: number;
  stage: ReviewCaseStage;
  stage_label: string;
  status: string;
  round: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  final_decision: ReviewDecision | null;
  final_decision_label?: string;
  final_comment: string | null;
  task_total: number;
  submitted_count: number;
  conflict_count: number;
  assigned_count: number;
  artifact_count: number;
  tasks?: ReviewTask[];
  artifacts?: ReviewArtifact[];
  actions?: ReviewAction[];
}

export interface ReviewerOption {
  username: string;
  display_name: string;
  expert_id: number | null;
  expert_name: string;
  expert_institution: string;
}

export interface KeywordGraphSource { doc_id: string; doc_name: string; chunk_idx: number; section: string; page: number | null; excerpt: string; }
export interface KeywordGraphNode { id: string; name: string; chunk_count: number; sources: KeywordGraphSource[]; cluster: number | null; }
export interface KeywordGraphLink { source: string; target: string; similarity: number; shared_chunks: number; }
export interface KeywordGraphData { nodes: KeywordGraphNode[]; links: KeywordGraphLink[]; method: string; document_count: number; limit: number; }
