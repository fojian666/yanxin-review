import type {
  ChatHistoryItem,
  Citation,
  DocItem,
  Health,
  Paper,
  Expert,
  ReviewReport,
  StreamHandlers,
  ToolCheckResult,
  TrendData,
} from "./types";

const API = "/api";
const DEFAULT_TIMEOUT_MS = 60000;

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (typeof obj.detail === "string") return obj.detail;
    if (typeof obj.error === "string") return obj.error;
  }
  if (typeof data === "string" && data.trim()) return data;
  return `请求失败 (${status})`;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("请求超时，请确认服务是否正常运行");
    }
    throw new Error("网络错误，无法连接到服务器");
  } finally {
    clearTimeout(timer);
  }
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(errorMessage(data, res.status));
  return data as T;
}

function jsonOptions(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  health: () => request<Health>("/health"),
  documents: () => request<{ documents: DocItem[] }>("/documents"),
  papers: () => request<{ papers: Paper[]; count: number }>("/papers"),
  chat: (question: string, history: ChatHistoryItem[], scope: string[]) =>
    request<{ answer: string; citations: Citation[]; mode: string; warning: string }>(
      "/chat",
      jsonOptions({ question, history, scope })
    ),
  review: (docId: string) =>
    request<ReviewReport>("/review", jsonOptions({ doc_id: docId })),
  trends: (query: string, startYear: number, endYear: number) =>
    request<TrendData>(
      "/trends",
      jsonOptions({ query, start_year: startYear, end_year: endYear })
    ),
  uploadDocument: async (
    file: File,
    meta: { kind: string; year: string; title: string }
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", meta.kind);
    fd.append("year", meta.year);
    fd.append("title", meta.title);
    return request<{ document: DocItem; warning: string }>("/documents", {
      method: "POST",
      body: fd,
    });
  },
  importPapers: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ ok: boolean; count: number }>("/papers/import", {
      method: "POST",
      body: fd,
    });
  },
  deleteDocument: (docId: string) =>
    request<{ ok: boolean }>(`/documents/${docId}`, { method: "DELETE" }),
  removeSamplePapers: () =>
    request<{ ok: boolean; removed: number }>("/papers/sample", { method: "DELETE" }),
  experts: () => request<{ experts: Expert[]; count: number }>("/experts"),
  importExperts: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ ok: boolean; count: number }>("/experts/import", {
      method: "POST",
      body: fd,
    });
  },
  removeSampleExperts: () =>
    request<{ ok: boolean; removed: number }>("/experts/sample", { method: "DELETE" }),
  toolCheck: (docId: string, topK = 8) =>
    request<ToolCheckResult>("/tool/check", jsonOptions({ doc_id: docId, top_k: topK })),
};

export async function streamChat(
  payload: { question: string; history: ChatHistoryItem[]; scope: string[] },
  handlers: StreamHandlers
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API}/chat/stream`, jsonOptions(payload));
  } catch {
    throw new Error("网络错误，无法连接到服务器");
  }
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }
    throw new Error(errorMessage(data, res.status));
  }
  if (!res.body) throw new Error("浏览器不支持流式响应");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  while (true) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === "meta") {
        handlers.onMeta({
          citations: (event.citations as Citation[]) ?? [],
          mode: String(event.mode ?? "offline"),
          warning: String(event.warning ?? ""),
        });
      } else if (event.type === "token") {
        handlers.onToken(String(event.text ?? ""));
      } else if (event.type === "warning") {
        handlers.onWarning(String(event.message ?? ""));
      } else if (event.type === "error") {
        throw new Error(String(event.message ?? "生成失败"));
      } else if (event.type === "done") {
        if (!done) {
          done = true;
          handlers.onDone();
        }
      }
    }
  }
  if (!done) handlers.onDone();
}

export function locationText(c: Citation): string {
  if (c.page) return `第 ${c.page} 页`;
  if (c.section) return c.section;
  return "正文";
}
