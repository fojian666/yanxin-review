import { Link } from "react-router-dom";
import type { DuplicateMatch } from "../types";

export function DuplicateSource({ match }: { match: DuplicateMatch }) {
  return match.restricted || !match.matched_doc_id
    ? <span>{match.matched_doc_name}（原文受保护）</span>
    : <Link className="evidence-doc-link" to={`/library?doc=${encodeURIComponent(match.matched_doc_id)}`} aria-label={`打开《${match.matched_doc_name}》原文`}>{match.matched_doc_name}</Link>;
}

export function DuplicateComparison({ match }: { match: DuplicateMatch }) {
  return match.restricted
    ? <p className="check-evidence">对方材料仅供授权核验。</p>
    : <p className="check-evidence">比对：{match.matched_snippet}</p>;
}
