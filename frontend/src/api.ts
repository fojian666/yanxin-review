import type {
  AuthUser,
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
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login")) {
      // 会话失效：广播给全局状态切回登录页
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
    throw new Error(errorMessage(data, res.status));
  }
  return data as T;
}

function jsonOptions(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// fetch 无法拿到上传进度，上传走 XHR
function requestFormData<T>(
  path: string,
  fd: FormData,
  onProgress?: (pct: number) => void,
  timeoutMs = 180000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}${path}`);
    xhr.timeout = timeoutMs;
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
    }
    xhr.onload = () => {
      let data: unknown = null;
      const contentType = xhr.getResponseHeader("content-type") || "";
      try {
        data = contentType.includes("application/json")
          ? JSON.parse(xhr.responseText)
          : xhr.responseText;
      } catch {
        data = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
        return;
      }
      if (xhr.status === 401) {
        // 与 request() 一致：会话失效广播，切回登录页
        window.dispatchEvent(new CustomEvent("auth:expired"));
      }
      reject(new Error(errorMessage(data, xhr.status)));
    };
    xhr.onerror = () => reject(new Error("网络错误，无法连接到服务器"));
    xhr.ontimeout = () => reject(new Error("上传超时，请重试"));
    xhr.send(fd);
  });
}

export const api = {
  me: () => request<AuthUser>("/auth/me"),
  login: (username: string, password: string) =>
    request<{ ok: boolean; user: AuthUser }>(
      "/auth/login",
      jsonOptions({ username, password })
    ),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  listUsers: () =>
    request<{ users: { username: string; role: string; display_name: string; created_at: string }[]; roles: Record<string, string> }>(
      "/auth/users"
    ),
  createUser: (payload: { username: string; password: string; role: string; display_name: string }) =>
    request<{ ok: boolean }>("/auth/users", jsonOptions(payload)),
  health: () => request<Health>("/health"),
  documents: () => request<{ documents: DocItem[] }>("/documents"),
  papers: () => request<{ papers: Paper[]; count: number }>("/papers"),
  review: (docId: string) =>
    request<ReviewReport>("/review", jsonOptions({ doc_id: docId })),
  trends: (query: string, startYear: number, endYear: number) =>
    request<TrendData>(
      "/trends",
      jsonOptions({ query, start_year: startYear, end_year: endYear })
    ),
  uploadDocument: (
    file: File,
    meta: { kind: string; year: string; title: string },
    onProgress?: (pct: number) => void
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", meta.kind);
    fd.append("year", meta.year);
    fd.append("title", meta.title);
    return requestFormData<{ document: DocItem; warning: string }>(
      "/documents",
      fd,
      onProgress
    );
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
  removeSampleDocuments: () =>
    request<{ ok: boolean; removed: number }>("/documents/sample", { method: "DELETE" }),
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
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API}/chat/stream`, { ...jsonOptions(payload), signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error("网络错误，无法连接到服务器");
  }
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
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

  const dispatch = (frame: string) => {
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"));
    if (!dataLines.length) return;
    const raw = dataLines.map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!raw) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
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
  };

  try {
    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) dispatch(frame);
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer);
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  if (!done && !signal?.aborted) handlers.onDone();
}

export function locationText(c: Citation): string {
  if (c.page) return `第 ${c.page} 页`;
  if (c.section) return c.section;
  return "正文";
}
