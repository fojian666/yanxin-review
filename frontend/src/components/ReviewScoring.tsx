import type { ReviewScoring, ReviewScoreItem } from "../types";
import { AdaptivePager } from "./AdaptivePager";

const SCORE_STATUS: Record<ReviewScoreItem["status"], string> = {
  pass: "通过", partial: "部分满足", fail: "未满足", pending: "待核验",
};

export function reviewScoreValue(scoring?: ReviewScoring): string {
  if (!scoring) return "未记录";
  return scoring.final_score == null ? `${scoring.earned}–${scoring.upper_bound}` : String(scoring.final_score);
}

function itemPoints(item: Pick<ReviewScoreItem, "maximum" | "earned" | "pending_points">): string {
  const deducted = Math.max(0, Number((item.maximum - item.earned - item.pending_points).toFixed(2)));
  return `已确认 ${item.earned} / ${item.maximum} 分 · 待核验 ${item.pending_points} 分 · 已确认扣分 ${deducted} 分`;
}

export function reviewScoringMarkdown(scoring?: ReviewScoring): string[] {
  if (!scoring) return ["## 规则计分", "未记录：历史报告未保存规则计分，不推算分数。", ""];
  const lines = [
    `## ${scoring.label}${scoring.label.includes("试行") ? "" : "（试行）"}`,
    `- ${scoring.final_score == null ? "待核验区间" : "规则得分"}：${reviewScoreValue(scoring)} / ${scoring.maximum} 分`,
    `- 已确认得分：${scoring.earned} 分；已核验权重：${scoring.maximum - scoring.pending_points} 分；待核验权重：${scoring.pending_points} 分`,
    `- 风险等级：${scoring.risk_level}；${scoring.risk_reason}`,
    `- 分档规则：低风险 ≥${scoring.thresholds.low} 分，中风险 ≥${scoring.thresholds.medium} 分，高风险 <${scoring.thresholds.medium} 分；未决项跨档时待核验，关键问题单独提示。`,
    `- 规则版本：${scoring.version}`,
    "", "### 关键问题",
    ...(scoring.critical_issues.length ? scoring.critical_issues.flatMap(issue => [
      `- ${issue.label}：${issue.detail}`, ...(issue.evidence ? [`  - 依据：${issue.evidence}`] : []),
    ]) : ["未记录关键问题，仍须人工复核。"]),
  ];
  scoring.dimensions.forEach(dimension => {
    lines.push("", `### ${dimension.label}（${itemPoints(dimension)}）`);
    dimension.items.forEach(item => lines.push(
      `- [${SCORE_STATUS[item.status]}] ${item.label}：${itemPoints(item)}`,
      `  - 核验与扣分原因：${item.detail}`,
      `  - 依据：${item.evidence || "未记录，须人工补充核验。"}`,
    ));
  });
  const duplicate = scoring.duplicate_metrics;
  if (duplicate) lines.push("", "### 查重覆盖口径",
    `- 候选疑似字面覆盖率（非全文重复率）：${duplicate.coverage == null ? "待核验" : `${(duplicate.coverage * 100).toFixed(1)}%`}；命中字数 ${duplicate.matched_characters} / ${duplicate.total_characters}；最长单来源连续覆盖 ${duplicate.longest_span} 字；比对候选 ${duplicate.candidates_checked} 份`,
    `- ${duplicate.scope_note}`, `- 人工复核：${duplicate.pending_review ? "待核验" : "按规则记录，仍须人工复核"}`);
  lines.push("", scoring.disclaimer, "");
  return lines;
}

export function ReviewScoringSummary({ scoring, compact = false, boundaryFirst = false }: { scoring?: ReviewScoring; compact?: boolean; boundaryFirst?: boolean }) {
  if (!scoring) return <p className="review-score-unrecorded">规则计分：未记录。历史报告未保存计分，不推算分数。</p>;
  const duplicate = scoring.duplicate_metrics;
  return (
    <section className={`review-scoring${compact ? " is-compact" : ""}`} aria-label="规则计分概览">
      <div className="review-score-heading">
        <h3>{scoring.label.replace(/[（(]试行[）)]/g, "")} <span>试行 · 待人工复核</span></h3>
        {!compact && <strong className="review-score-value">{reviewScoreValue(scoring)}<small> / {scoring.maximum} 分</small></strong>}
      </div>
      <p className="review-score-confirmed">{!compact && `${scoring.final_score == null ? "待核验区间" : "规则得分"} · `}已确认得分 {scoring.earned} 分 · 已核验权重 {scoring.maximum - scoring.pending_points} 分 · 待核验权重 {scoring.pending_points} 分</p>
      <p className="review-score-reason"><strong>风险等级：{scoring.risk_level}</strong> · {scoring.risk_reason}</p>
      {boundaryFirst && <p className="review-score-disclaimer"><strong>能力边界：</strong>{scoring.disclaimer}</p>}
      <dl className="review-score-dimensions">
        {scoring.dimensions.map(dimension => <div key={dimension.key}>
          <dt>{dimension.label}</dt>
          <dd>已确认 {dimension.earned} / {dimension.maximum}<span>待核验 {dimension.pending_points} 分</span></dd>
        </div>)}
      </dl>
      <div className="review-score-critical">
        <h4>关键问题（独立提示）</h4>
        {scoring.critical_issues.length ? scoring.critical_issues.map(issue => <div key={issue.key}>
          <strong>{issue.label}</strong><p>{issue.detail}</p>{issue.evidence && <blockquote>{issue.evidence}</blockquote>}
        </div>) : <p>未记录关键问题，仍须人工复核。</p>}
      </div>
      {duplicate && <p className="review-score-duplicate">候选疑似字面覆盖率（非全文重复率）{duplicate.coverage == null ? "待核验" : `${(duplicate.coverage * 100).toFixed(1)}%`} · 命中字数 {duplicate.matched_characters} / {duplicate.total_characters} · 最长单来源连续覆盖 {duplicate.longest_span} 字 · 比对候选 {duplicate.candidates_checked} 份。{duplicate.scope_note}{duplicate.pending_review && " 仍待人工核验。"}</p>}
      {!boundaryFirst && <p className="review-score-disclaimer">{scoring.disclaimer}</p>}
      <p className="review-score-rule">低风险 ≥{scoring.thresholds.low} 分 · 中风险 ≥{scoring.thresholds.medium} 分 · 高风险 &lt;{scoring.thresholds.medium} 分；未决项跨档时待核验。规则版本 {scoring.version}</p>
    </section>
  );
}

export function ReviewScoringChecks({ scoring, resetKey }: { scoring: ReviewScoring; resetKey?: string }) {
  const items = scoring.dimensions.flatMap(dimension => dimension.items.map(item => ({ dimension, item })));
  return <AdaptivePager
    className="review-check-list review-score-check-list"
    label="计分依据"
    items={items}
    resetKey={resetKey}
    getKey={({ dimension, item }) => `${dimension.key}:${item.key}`}
    renderItem={({ dimension, item }) => <section className="section-block">
      <div className="section-head"><h3>{dimension.label} · {dimension.maximum} 分</h3><span className={`review-score-status score-${item.status}`}>{SCORE_STATUS[item.status]}</span></div>
      <div className="review-evidence-body">
        <div className="check-item review-score-item">
          <h4 className="check-label">{item.label}</h4>
          <p className="review-score-points">{itemPoints(item)}</p>
          <p className="check-detail"><strong>核验与扣分原因：</strong>{item.detail}</p>
          <div className="check-evidence is-expanded"><strong>依据：</strong>{item.evidence || "未记录，须人工补充核验。"}</div>
        </div>
      </div>
    </section>}
  />;
}

export function ReviewScoringPrint({ scoring, includeSummary = true }: { scoring?: ReviewScoring; includeSummary?: boolean }) {
  return <section className="review-score-print">
    {includeSummary && <><h2>规则计分（试行）</h2><ReviewScoringSummary scoring={scoring} /></>}
    {scoring?.dimensions.map(dimension => <section key={dimension.key}>
      <h3>{dimension.label}（{itemPoints(dimension)}）</h3>
      {dimension.items.map(item => <div className="print-check-item" key={item.key}>
        <h4>{item.label}（{SCORE_STATUS[item.status]}）</h4>
        <p>{itemPoints(item)}</p><p>核验与扣分原因：{item.detail}</p><p>依据：{item.evidence || "未记录，须人工补充核验。"}</p>
      </div>)}
    </section>)}
  </section>;
}
