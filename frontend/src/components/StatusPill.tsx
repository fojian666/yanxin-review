import type { CheckStatus } from "../types";

const LABELS: Record<CheckStatus, string> = {
  pass: "通过",
  warn: "关注",
  fail: "风险",
};

const CLASSES: Record<CheckStatus, string> = {
  pass: "status-pass",
  warn: "status-warn",
  fail: "status-fail",
};

export function StatusPill({ status }: { status: CheckStatus }) {
  const safe = LABELS[status] ? status : "warn";
  return <span className={`status-pill ${CLASSES[safe]}`}>{LABELS[safe]}</span>;
}
