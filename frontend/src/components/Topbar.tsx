import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu, Upload, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { ROLE_LABELS, type UserRole } from "../types";
import { EASE, SPRING } from "../motion";

const META: Record<string, { title: string; sub: string }> = {
  "/welcome": { title: "工作台", sub: "选一处入口，或直接从一句提问开始" },
  "/chat": { title: "智能问答", sub: "只以你上传的资料作答，逐条附原文与页码" },
  "/trend": { title: "文献趋势", sub: "在多年文献的起伏里，读热度、读阶段、读空白" },
  "/match": { title: "查重匹配", sub: "一次运行：段落查重与专家匹配并行，约束前置" },
  "/review": { title: "本子预审", sub: "形式、诚信、查重、政策四道关，AI 只勘不断" },
  "/library": { title: "文档库", sub: "资料入库、索引在册、文献成集" },
  "/admin": { title: "用户管理", sub: "账号与角色管理（仅管理员可见）" },
};

export function Topbar({ onOpenNav, navOpen = false }: { onOpenNav?: () => void; navOpen?: boolean }) {
  const { pathname } = useLocation();
  const { health, auth, openUpload, can, logout } = useApp();
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  // 点击菜单外关闭 + ESC
  useEffect(() => {
    if (!userOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!userRef.current?.contains(e.target as Node)) setUserOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setUserOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [userOpen]);
  const meta = META[pathname] ?? META["/chat"];
  const online = Boolean(health?.llm.configured);
  const roleLabel = auth ? ROLE_LABELS[auth.role as UserRole] ?? auth.role : "";
  // 演示账号的 display_name 与角色标签同名，直接用登录名避免出现「管理员 / 管理员」两行重复
  const displayName = auth?.display_name || auth?.username || "";
  const chipName = displayName === roleLabel ? auth?.username || displayName : displayName;

  useEffect(() => {
    document.title = `${meta.title} · 研信智评`;
  }, [meta.title]);

  return (
    <header className="topbar" onDragStart={(event) => event.preventDefault()}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className="topbar-title"
          key={pathname}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.23, ease: EASE }}
        >
          <div className="eyebrow">RESEARCH INTEGRITY · AI REVIEW</div>
          <h1>{meta.title}</h1>
          <p>{meta.sub}</p>
        </motion.div>
      </AnimatePresence>
      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn mobile-nav-btn"
          onClick={onOpenNav}
          aria-label="打开导航"
          aria-controls="site-nav"
          aria-expanded={navOpen}
          title="导航"
        >
          <Menu size={18} />
        </button>
        <span
          className={`mode-chip ${online ? "online" : ""}`}
          title={
            online
              ? `模型：${health?.llm.model}；接口：${health?.llm.base_url}`
              : `${health?.llm.label || "离线演示"}：设置内网 QWEN_BASE_URL 后启用；公网端点需显式 ALLOW_EXTERNAL_LLM=1。`
          }
        >
          <span className="status-dot" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={online ? `online-${health?.llm.model ?? ""}` : "offline"}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              {online ? `大模型 · ${health?.llm.model}` : "离线演示"}
            </motion.span>
          </AnimatePresence>
        </span>
        {can("upload") && (
          <motion.button
            className="btn btn-primary"
            onClick={() => openUpload()}
            aria-label="上传文档"
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.34, ease: EASE }}
          >
            <Upload size={17} />
            <span className="btn-label">上传文档</span>
          </motion.button>
        )}
        {auth && (
          <div className="user-menu" ref={userRef}>
            <button
              className="user-trigger"
              onClick={() => setUserOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={userOpen}
              title={chipName}
            >
              <span className="user-avatar small">
                <UserRound size={16} />
              </span>
              <span className="user-trigger-text">
                <strong>{chipName}</strong>
                <span className={`role-badge role-${auth.role}`}>{roleLabel}</span>
              </span>
            </button>
            {userOpen && (
              <motion.div
                className="user-dropdown"
                role="menu"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={SPRING}
              >
                <div className="user-dropdown-head">
                  <UserRound size={14} />
                  <span>{auth.username}</span>
                </div>
                <button
                  className="user-dropdown-item"
                  role="menuitem"
                  onClick={() => {
                    setUserOpen(false);
                    void logout();
                  }}
                >
                  <LogOut size={15} />
                  退出登录
                </button>
              </motion.div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
