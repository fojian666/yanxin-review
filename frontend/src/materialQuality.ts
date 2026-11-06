export const QUALITY_LABELS: Record<string, string> = {
  queued: "等待处理", processing: "本地识别中", indexing: "更新索引中",
  ready: "文字已提取", partial: "部分可用", failed: "处理失败",
};
export const materialBusy = (state?: string) => ["queued", "processing", "indexing"].includes(state ?? "");
