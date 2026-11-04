import { Link } from "react-router-dom";
import { generationLabel } from "../generation";
import type { ReviewArtifact, ReviewReport, ToolCheckResult } from "../types";

/** 补充未写入归档正文的依据与原文链接；不改写已签名的正文或摘要。 */
export function ArtifactEvidence({ artifact }: { artifact: ReviewArtifact }) {
  const content = artifact.content || "";
  if (artifact.artifact_type === "pre_review") {
    const report = artifact.payload as unknown as Partial<ReviewReport>;
    const limitations = (report.limitations || []).filter((item) => item && !content.includes(item));
    const questions = (report.questions || []).filter((item) => item && !content.includes(item));
    const warning = report.warning && !content.includes(report.warning) ? report.warning : "";
    const source = report.generation && !content.includes("生成来源") ? generationLabel(report.generation, "规则预审") : "";
    const evidence = (report.sections || []).flatMap((section) => section.items || [])
      .filter((item) => item.source_doc_id || (item.evidence_full && !content.includes(item.evidence_full)));
    if (!limitations.length && !evidence.length && !questions.length && !warning && !source) return null;
    return (
      <section className="msg-content" aria-label="归档补充依据">
        <h3>归档补充依据</h3>
        {source && <p>生成来源：{source}</p>}
        {warning && <p>{warning}</p>}
        {limitations.length > 0 && <><h4>能力边界</h4><ul>{limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
        {questions.length > 0 && <><h4>待核实问题</h4><ul>{questions.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
        {evidence.map((item, index) => (
          <div key={index}>
            <strong>{item.label}</strong>
            {item.evidence_full && !content.includes(item.evidence_full) && <p>{item.evidence_full}</p>}
            {item.source_doc_id && <p><Link to={`/library?doc=${encodeURIComponent(item.source_doc_id)}`}>查看证据原文</Link></p>}
          </div>
        ))}
      </section>
    );
  }
  if (artifact.artifact_type === "tool_check") {
    const result = artifact.payload as unknown as Partial<ToolCheckResult>;
    const matches = (result.duplicate?.matches || []).filter((item) =>
      item.matched_doc_id || (item.source_snippet && !content.includes(item.source_snippet)) || (item.matched_snippet && !content.includes(item.matched_snippet))
    );
    const notes = [result.match?.applicant_warning, result.match?.institution_match_note]
      .filter((item): item is string => Boolean(item) && !content.includes(item as string));
    if (!matches.length && !notes.length) return null;
    return (
      <section className="msg-content" aria-label="归档补充依据">
        <h3>归档补充依据</h3>
        {notes.map((note, index) => <p key={index}>{note}</p>)}
        {matches.map((item, index) => (
          <div key={`${item.matched_doc_id}-${index}`}>
            <strong>{item.matched_doc_name}</strong>
            {item.source_snippet && !content.includes(item.source_snippet) && <p>本文：{item.source_snippet}</p>}
            {item.matched_snippet && !content.includes(item.matched_snippet) && <p>比对：{item.matched_snippet}</p>}
            {item.matched_doc_id && <p><Link to={`/library?doc=${encodeURIComponent(item.matched_doc_id)}`}>查看比对文档</Link></p>}
          </div>
        ))}
      </section>
    );
  }
  return null;
}
