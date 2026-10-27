import type { GenerationInfo, LlmStatus } from "./types";

export function modelLabel(info: Pick<LlmStatus, "label" | "model">): string {
  return [info.label || "大模型", info.model].filter(Boolean).join(" · ");
}

export function generationLabel(info?: GenerationInfo, offlineLabel = "离线摘录"): string {
  if (!info) return "来源未记录";
  if (info.provider === "offline") {
    if (info.status === "fallback") return `已回退${offlineLabel}`;
    return offlineLabel + (info.status === "interrupted" ? "（生成中断）" : "");
  }
  return modelLabel(info) + (info.status === "interrupted" ? "（生成中断）" : "");
}
