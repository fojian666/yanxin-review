import type { ChatSelection } from "./types";
import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { api } from "./api";
import { EASE } from "./motion";
import type { AuthUser, ChatMessage, Citation, DocItem, Health, Paper } from "./types";

interface ToastState {
  id: number;
  message: string;
  type: "info" | "error";
}

interface AppContextValue {
  auth: AuthUser | null;
  authReady: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  can: (action: string) => boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  health: Health | null;
  docs: DocItem[];
  papers: Paper[];
  loading: boolean;
  selectedDocs: string[];
  setSelectedDocs: (ids: string[]) => void;
  chatMessages: ChatMessage[];
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  chatCitations: Citation[];
  setChatCitations: Dispatch<SetStateAction<Citation[]>>;
  refreshDocs: () => Promise<void>;
  refreshPapers: () => Promise<void>;
  toast: (message: string, type?: "info" | "error") => void;
  chatSelection: ChatSelection;
  setChatSelection: (selection: ChatSelection) => void;
  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;
  uploadSeedFile: File | null;
  openUpload: (file?: File) => void;
  clearUploadSeed: () => void;
}

// 前端权限矩阵只做界面门控；真实约束由后端角色依赖执行
const PERMISSIONS: Record<string, string[]> = {
  upload: ["manager", "admin"],
  "delete-doc": ["manager", "admin"],
  import: ["manager", "admin"],
  "remove-sample": ["manager", "admin"],
  review: ["reviewer", "manager", "admin"],
  tool: ["reviewer", "manager", "admin"],
  admin: ["admin"],
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthUser | null>(null);
  const authRef = useRef<AuthUser | null>(null);
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);
  const [authReady, setAuthReady] = useState(false);
  // 侧边栏折叠状态：localStorage 持久化；无记录时按屏幕宽度给默认值
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem("yanxin.sidebar");
      if (saved === "1") return true;
      if (saved === "0") return false;
    } catch {
      // 忽略存储异常
    }
    return window.innerWidth < 980;
  });
  const [chatSelection, setChatSelection] = useState<ChatSelection>({ model: "default", strength: "default" });
  const [health, setHealth] = useState<Health | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatCitations, setChatCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSeedFile, setUploadSeedFile] = useState<File | null>(null);
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);

  const clearUploadSeed = useCallback(() => setUploadSeedFile(null), []);
  const openUpload = useCallback((file?: File) => {
    setUploadSeedFile(file ?? null);
    setUploadOpen(true);
  }, []);

  const toast = useCallback((message: string, type: "info" | "error" = "info") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToastState({ id: Date.now(), message, type });
    toastTimer.current = window.setTimeout(() => setToastState(null), 3400);
  }, []);

  // 会话切换时统一清理，避免上一位用户的问答/引用/上传态残留
  const resetSession = useCallback(() => {
    setDocs([]);
    setPapers([]);
    setSelectedDocs([]);
    setChatSelection({ model: "default", strength: "default" });
    setChatMessages([]);
    setChatCitations([]);
    setHealth(null);
    setUploadOpen(false);
    setUploadSeedFile(null);
    setLoading(true);
  }, []);

  const refreshDocs = useCallback(async () => {
    const data = await api.documents();
    setDocs(data.documents);
    setSelectedDocs((current) => current.filter((id) => data.documents.some((d) => d.id === id)));
  }, []);

  const refreshPapers = useCallback(async () => {
    const data = await api.papers();
    setPapers(data.papers);
  }, []);

  // 启动时验证会话；失效回到登录页
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await api.me();
        if (!cancelled) setAuth(user);
      } catch {
        // 401：未登录
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 任意请求返回 401 → 会话过期，切回登录页并清理残留状态
  useEffect(() => {
    const onExpired = () => {
      // 未登录时的 /auth/me 401 属于正常访客，不提示“已过期”
      if (!authRef.current) return;
      authRef.current = null;
      setAuth(null);
      resetSession();
      toast("会话已过期，请重新登录", "error");
    };
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, [resetSession, toast]);

  const loadInitial = useCallback(async () => {
    try {
      const [h, d, p] = await Promise.all([api.health(), api.documents(), api.papers()]);
      setHealth(h);
      setDocs(d.documents);
      setPapers(p.papers);
    } catch (err) {
      toast(`初始化失败：${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!authReady || !auth) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      if (!cancelled) await loadInitial();
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, auth, loadInitial]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    resetSession();
    authRef.current = result.user;
    setAuth(result.user);
    return result.user;
  }, [resetSession]);

  const logout = useCallback(async () => {
    let message = "已退出登录";
    let type: "info" | "error" = "info";
    try {
      await api.logout();
    } catch (err) {
      message = `退出登录请求失败：${(err as Error).message}`;
      type = "error";
    }
    authRef.current = null;
    setAuth(null);
    resetSession();
    toast(message, type);
  }, [resetSession, toast]);

  const can = useCallback(
    (action: string) => Boolean(auth && (PERMISSIONS[action] || []).includes(auth.role)),
    [auth]
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("yanxin.sidebar", next ? "1" : "0");
      } catch {
        // 忽略存储异常
      }
      return next;
    });
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      auth,
      authReady,
      login,
      logout,
      can,
      sidebarCollapsed,
      toggleSidebar,
      health,
      docs,
      papers,
      loading,
      selectedDocs,
      setSelectedDocs,
      chatMessages,
      setChatMessages,
      chatCitations,
      setChatCitations,
      refreshDocs,
      refreshPapers,
      toast,
      chatSelection,
      setChatSelection,
      uploadOpen,
      setUploadOpen,
      uploadSeedFile,
      openUpload,
      clearUploadSeed,
    }),
    [chatSelection, auth, authReady, login, logout, can, sidebarCollapsed, toggleSidebar, health, docs, papers, loading, selectedDocs, chatMessages, chatCitations, refreshDocs, refreshPapers, toast, uploadOpen, uploadSeedFile, openUpload, clearUploadSeed, resetSession]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {toastState && (
          <motion.div
            key={toastState.id}
            className={`toast ${toastState.type === "error" ? "error" : ""}`}
            role={toastState.type === "error" ? "alert" : "status"}
            aria-live="polite"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.29, ease: EASE }}
          >
            {toastState.message}
          </motion.div>
        )}
      </AnimatePresence>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
