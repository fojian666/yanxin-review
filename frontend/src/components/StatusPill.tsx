import type { CheckStatus } from "../types";

type StatusTone = CheckStatus | "idle" | "error";

const LABELS: Record<StatusTone, string> = {
  pass: "通过",
  warn: "关注",
  fail: "风险",
  idle: "未检查",
  error: "读取失败",
};

const CLASSES: Record<StatusTone, string> = {
  pass: "status-pass",
  warn: "status-warn",
  fail: "status-fail",
  idle: "status-idle",
  error: "status-fail",
};

export function StatusPill({ status }: { status: StatusTone }) {
  const safe = LABELS[status] ? status : "idle";
  return <span className={`status-pill ${CLASSES[safe]}`}>{LABELS[safe]}</span>;
}
