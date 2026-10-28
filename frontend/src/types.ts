export type UserRole = "admin" | "manager" | "reviewer" | "viewer";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  manager: "科研管理",
  reviewer: "评审专家",
  viewer: "访客",
};

export interface AuthUser {
  username: string;
  role: Role;
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
  retrieval?: {
    mode: "tfidf" | "embedding";
    model: string;
    chunks: number;
  };
}

export interface DocItem {
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

export interface ReviewItem {
  label: string;
  status: CheckStatus;
  detail: string;
  evidence: string;
  /** 政策条款全文（evidence 为短摘要，供「展开全文」用） */
  evidence_full?: string;
}

export interface ReviewSection {
  key: string;
  title: string;
  status: CheckStatus;
  items: ReviewItem[];
}

export interface ReviewMatch {
  matched_doc_name: string;
  similarity: number;
  source_snippet: string;
  matched_snippet: string;
}

export interface ReviewReport {
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
}

export interface DuplicateResult {
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
