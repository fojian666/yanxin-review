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
import type { ChatMessage, Citation, DocItem, Health, Paper } from "./types";

interface ToastState {
  id: number;
  message: string;
  type: "info" | "error";
}

interface AppContextValue {
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
  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;
  uploadSeedFile: File | null;
  openUpload: (file?: File) => void;
  clearUploadSeed: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
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

  const refreshDocs = useCallback(async () => {
    const data = await api.documents();
    setDocs(data.documents);
    setSelectedDocs((current) => current.filter((id) => data.documents.some((d) => d.id === id)));
  }, []);

  const refreshPapers = useCallback(async () => {
    const data = await api.papers();
    setPapers(data.papers);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [h, d, p] = await Promise.all([api.health(), api.documents(), api.papers()]);
        if (cancelled) return;
        setHealth(h);
        setDocs(d.documents);
        setPapers(p.papers);
      } catch (err) {
        if (!cancelled) toast(`初始化失败：${(err as Error).message}`, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const value = useMemo<AppContextValue>(
    () => ({
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
      uploadOpen,
      setUploadOpen,
      uploadSeedFile,
      openUpload,
      clearUploadSeed,
    }),
    [health, docs, papers, loading, selectedDocs, chatMessages, chatCitations, refreshDocs, refreshPapers, toast, uploadOpen, uploadSeedFile, openUpload, clearUploadSeed]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {toastState && (
          <motion.div
            key={toastState.id}
            className={`toast ${toastState.type === "error" ? "error" : ""}`}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE }}
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
