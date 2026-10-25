import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  FileText,
  FolderOpen,
  Loader2,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { locationText, streamChat } from "../api";
import { useApp } from "../AppContext";
import { EmptyState } from "../components/EmptyState";
import { Markdown } from "../components/Markdown";
import { EASE, SPRING, staggerContainer, staggerItem } from "../motion";
import type { ChatHistoryItem, ChatMessage, Citation } from "../types";

const QUICK_CARDS = [
  {
    icon: ScrollText,
    title: "梳理核心内容",
    desc: "研究内容、技术路线、考核指标，一次理清",
    question: "这份本子的研究内容和技术路线是什么？",
  },
  {
    icon: ShieldCheck,
    title: "检查诚信与规范",
    desc: "诚信、数据安全、伦理与知识产权，逐项对照",
    question: "这份本子在科研诚信和数据安全方面有哪些需要补充的内容？",
  },
  {
    icon: Sparkles,
    title: "辨创新与重复",
    desc: "提炼创新点，提示与已有研究的重叠",
    question: "请总结这份本子的创新点，并指出与已有研究可能重复的地方。",
  },
  {
    icon: FileText,
    title: "拟评审追问",
    desc: "把材料缺口，转成专家会问的问题",
    question: "如果我是评审专家，应该向申报人重点追问哪些问题？",
  },
];

function now() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function ChatPage() {
  const {
    docs,
    selectedDocs,
    setSelectedDocs,
    toast,
    openUpload,
    can,
    chatMessages: messages,
    setChatMessages: setMessages,
    chatCitations: citations,
    setChatCitations: setCitations,
  } = useApp();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [focusedSource, setFocusedSource] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const focusTimer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const runningRef = useRef(false);

  const scopeLabel =
    selectedDocs.length === 0
      ? "全部文档"
      : selectedDocs.length === 1
        ? docs.find((d) => d.id === selectedDocs[0])?.name ?? "已选 1 份"
        : `已选 ${selectedDocs.length} 份`;

  useEffect(() => {
    const el = scrollRef.current;
    // 空态不滚动，避免短视口一进来就把欢迎语顶出视野
    if (!el || (!messages.length && !citations.length)) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, citations]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!scopeRef.current?.contains(event.target as Node)) setScopeOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setScopeOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [input]);

  const focusSource = (index: number) => {
    const el = document.getElementById(`source-${index}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setFocusedSource(index);
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => setFocusedSource(null), 1300);
  };

  useEffect(() => {
    return () => {
      if (focusTimer.current) window.clearTimeout(focusTimer.current);
      runIdRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  const send = async (preset?: string) => {
    if (busy || runningRef.current) return;
    const question = (preset ?? input).trim();
    if (!question) return;
    if (docs.length === 0) {
      if (can("upload")) {
        toast("请先上传一份文档，再开始提问", "error");
        openUpload();
      } else {
        toast("当前没有可提问的文档，请联系科研管理人员上传", "error");
      }
      return;
    }
    const history: ChatHistoryItem[] = messages
      .filter((m) => m.content && !m.streaming)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));
    const assistantId = uid();
    const ts = now();
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "user", content: question, time: ts },
      { id: assistantId, role: "assistant", content: "", streaming: true, citations: [], time: ts },
    ]);
    setCitations([]);
    setInput("");
    setBusy(true);
    runningRef.current = true;

    const runId = ++runIdRef.current;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const isCurrent = () => runId === runIdRef.current;
    try {
      await streamChat(
        {
          question,
          history,
          scope: selectedDocs,
        },
        {
          onMeta: (meta) => {
            if (!isCurrent()) return;
            setCitations(meta.citations);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, citations: meta.citations, warning: meta.warning || m.warning }
                  : m
              )
            );
          },
          onToken: (token) => {
            if (!isCurrent()) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + token } : m
              )
            );
          },
          onWarning: (message) => {
            if (!isCurrent()) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, warning: m.warning ? `${m.warning} ${message}` : message }
                  : m
              )
            );
          },
          onDone: () => {
            if (!isCurrent()) return;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
            );
          },
        },
        controller.signal
      );
    } catch (err) {
      if (controller.signal.aborted || !isCurrent()) {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
        );
        return;
      }
      const message = (err as Error).message;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false, error: message } : m
        )
      );
      toast(`回答生成失败：${message}`, "error");
    } finally {
      if (isCurrent()) {
        runningRef.current = false;
        setBusy(false);
        abortRef.current = null;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const toggleDoc = (id: string) => {
    if (selectedDocs.includes(id)) {
      setSelectedDocs(selectedDocs.filter((x) => x !== id));
    } else {
      setSelectedDocs([...selectedDocs, id]);
    }
  };

  return (
    <div className="chat-layout">
      <div className="panel chat-panel">
        <div className="chat-toolbar">
          <div className="scope-wrap" ref={scopeRef}>
            <button className="scope-btn" onClick={() => setScopeOpen((v) => !v)} aria-haspopup="menu" aria-expanded={scopeOpen}>
              <FolderOpen size={15} />
              <span className="scope-label">{scopeLabel}</span>
              <ChevronDown size={14} />
            </button>
            <AnimatePresence>
              {scopeOpen && (
                <motion.div
                  className="scope-menu"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={SPRING}
                >
                  {docs.length === 0 ? (
                    <div className="scope-option muted">暂无文档，请先上传</div>
                  ) : (
                    <>
                      <label className="scope-option scope-all">
                        <input
                          type="checkbox"
                          checked={selectedDocs.length === 0}
                          onChange={() => setSelectedDocs([])}
                        />
                        全部文档
                      </label>
                      {docs.map((doc) => (
                        <label className="scope-option" key={doc.id} title={doc.name}>
                          <input
                            type="checkbox"
                            checked={selectedDocs.includes(doc.id)}
                            onChange={() => toggleDoc(doc.id)}
                          />
                          <span className="name">{doc.name}</span>
                        </label>
                      ))}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="toolbar-right">
            <span className="muted">{docs.length} 份资料</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (busy) {
                  toast("请等待当前回答完成");
                  return;
                }
                setMessages([]);
                setCitations([]);
              }}
            >
              <Trash2 size={14} />
              清空对话
            </button>
          </div>
        </div>

        <div className="chat-messages" ref={scrollRef}>
          <AnimatePresence mode="wait" initial={false}>
            {messages.length === 0 ? (
              <motion.div
                className="welcome"
                key="welcome"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.31, ease: EASE }}
              >
                <motion.div
                  className="welcome-mark"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ ...SPRING, delay: 0.04 }}
                >
                  <ShieldCheck size={27} />
                </motion.div>
                <h2>把本子放进来，让 AI 先读、先问、先核</h2>
                <p>
                  支持 DOCX / PDF / TXT / MD。回答只以你上传的资料为据，附页码与章节；资料不足，它会直说，不臆造。
                </p>
                <motion.div
                  className="quick-grid"
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                >
                  {QUICK_CARDS.map(({ icon: Icon, title, desc, question }) => (
                    <motion.button
                      className="quick-card"
                      key={title}
                      onClick={() => void send(question)}
                      variants={staggerItem}
                      whileTap={{ scale: 0.985 }}
                    >
                      <Icon size={17} />
                      <span>{title}</span>
                      <small>{desc}</small>
                    </motion.button>
                  ))}
                </motion.div>
                <div className="welcome-note">
                  提示：评审材料请在内网使用；演示版不会把文件发往任何未配置的外部服务。
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="messages"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.21, ease: EASE }}
              >
                <AnimatePresence initial={false}>
                  {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} onCite={focusSource} />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="composer">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="问点什么，例如：这份本子的研究内容和技术路线是什么？"
          />
          <motion.button
            className="btn btn-primary send-btn"
            onClick={() => void send()}
            disabled={busy}
            whileTap={busy ? undefined : { scale: 0.97 }}
            transition={{ duration: 0.34, ease: EASE }}
          >
            {busy ? <><Loader2 size={16} className="spin" />生成中</> : <><Send size={17} />发送</>}
          </motion.button>
        </div>
        <div className="composer-hint">
          <span className="kbd-hint">Enter 发送 · Shift + Enter 换行 · </span>
          回答仅供辅助，须人工复核
        </div>
      </div>

      <SourcesPanel citations={citations} focused={focusedSource} />
    </div>
  );
}

function MessageBubble({ message, onCite }: { message: ChatMessage; onCite: (index: number) => void }) {
  return (
    <motion.div
      className={`msg ${message.role}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.29, ease: EASE }}
    >
      <div className="msg-avatar">{message.role === "user" ? "我" : "AI"}</div>
      <div className="msg-body">
        <div className="msg-meta">
          <span>{message.role === "user" ? "你" : "研信智评"}</span>
          <span>{message.time ?? now()}</span>
        </div>
        {message.role === "user" ? (
          <div className="msg-content" style={{ whiteSpace: "pre-wrap" }}>
            {message.content}
          </div>
        ) : (
          <div className="msg-content assistant-content">
            {message.content ? (
              <Markdown content={message.content} onCite={onCite} className="markdown-body" />
            ) : message.streaming ? (
              <span className="typing"><i /><i /><i /></span>
            ) : null}
            {message.error && <div className="msg-error">生成中断：{message.error}</div>}
            {message.warning && <div className="answer-note">{message.warning}</div>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function SourcesPanel({ citations, focused }: { citations: Citation[]; focused: number | null }) {
  return (
    <aside className="panel sources-panel">
      <div className="panel-head">
        <div>
          <h2>证据与引用</h2>
          <p>回答里的 [1][2]，都对应此处原文与页码</p>
        </div>
        <span className="count-badge">{citations.length}</span>
      </div>
      <div className="sources">
        {citations.length === 0 ? (
          <EmptyState
            icon={<FileText size={38} />}
            description="提问后，命中的原文片段、页码与相似度列于此。"
          />
        ) : (
          citations.map((c, index) => {
            const pct = Math.min(99, Math.max(6, Math.round((c.score || 0) * 240)));
            return (
              <motion.div
                className={`source-card ${focused === c.index ? "flash" : ""}`}
                id={`source-${c.index}`}
                key={c.index}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.29, ease: EASE, delay: Math.min(index * 0.045, 0.18) }}
              >
                <div className="source-top">
                  <div className="source-index">{c.index}</div>
                  <div>
                    <div className="source-name">{c.doc_name}</div>
                    <div className="source-loc">{locationText(c)}</div>
                  </div>
                </div>
                <div className="source-text">{c.text}</div>
                <div className="source-foot">
                  <div className="score-bar"><i style={{ width: `${pct}%` }} /></div>
                  <span className="source-score">{(c.score || 0).toFixed(3)}</span>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </aside>
  );
}
