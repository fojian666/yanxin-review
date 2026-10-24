import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Upload, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { ROLE_LABELS, type UserRole } from "../types";
import { EASE, SPRING } from "../motion";

const META: Record<string, { title: string; sub: string }> = {
  "/chat": { title: "智能问答", sub: "基于上传资料回答，逐条给出原文依据" },
  "/trend": { title: "文献趋势", sub: "从多年论文中识别主题热度、阶段变化与研究空白" },
  "/match": { title: "查重匹配", sub: "智能查重 + 专家画像匹配一体化工具" },
  "/review": { title: "本子预审", sub: "形式、诚信、查重与政策合规的辅助检查" },
  "/library": { title: "文档库", sub: "上传资料、管理索引、导入文献数据" },
  "/admin": { title: "用户管理", sub: "账号与角色管理（仅管理员可见）" },
};

export function Topbar() {
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
              {online ? `千问 · ${health?.llm.model}` : "离线演示"}
            </motion.span>
          </AnimatePresence>
        </span>
        {can("upload") && (
          <motion.button
            className="btn btn-primary"
            onClick={() => openUpload()}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.34, ease: EASE }}
          >
            <Upload size={17} />
            上传文档
          </motion.button>
        )}
        {auth && (
          <div className="user-menu" ref={userRef}>
            <button
              className="user-trigger"
              onClick={() => setUserOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={userOpen}
              title={auth.display_name || auth.username}
            >
              <span className="user-avatar small">
                <UserRound size={16} />
              </span>
              <span className="user-trigger-text">
                <strong>{auth.display_name || auth.username}</strong>
                <span className={`role-badge role-${auth.role}`}>{ROLE_LABELS[auth.role as UserRole]}</span>
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
