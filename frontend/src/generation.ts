import type { ChatStrength, GenerationInfo, LlmStatus } from "./types";

export const STRENGTH_LABELS: Record<ChatStrength, string> = { default: "系统默认", quick: "关闭思考", low: "低", high: "高", max: "最高" };

export function modelLabel(info: Pick<LlmStatus, "label" | "model">): string {
  return [info.label || "大模型", info.model].filter(Boolean).join(" · ");
}

export function generationLabel(info?: GenerationInfo, offlineLabel = "离线摘录"): string {
  if (!info) return "来源未记录";
  if (info.provider === "offline") {
    if (info.status === "fallback") return `已回退${offlineLabel}`;
    return offlineLabel + (info.status === "interrupted" ? "（生成中断）" : "");
  }
  return modelLabel(info) + (info.strength ? ` · 强度：${STRENGTH_LABELS[info.strength]}` : "") + (info.status === "interrupted" ? "（生成中断）" : "");
}
