import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu, Upload, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { WORKSPACE_VIEWS } from "../data/workspaceViews";
import { modelLabel } from "../generation";
import { ROLE_LABELS, type UserRole } from "../types";
import { EASE, SPRING, MOTION, useMotionPreference } from "../motion";

const WELCOME_META = { title: "工作台", description: "围绕当前卷宗连续办理" };

// 窄屏先核验真实抽屉动画：关闭与导航会批处理，不能只读取 navOpen 初值。
function RouteArrival({ title, navOpen }: { title: string; navOpen: boolean }) {
  const [waiting, setWaiting] = useState(() => window.matchMedia("(max-width: 680px)").matches);
  useLayoutEffect(() => {
    if (!waiting || navOpen) return;
    const animations = document.getElementById("site-nav")?.getAnimations() ?? [];
    if (!animations.length) { setWaiting(false); return; }
    let active = true;
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (active) setWaiting(false);
    });
    return () => { active = false; };
  }, [waiting, navOpen]);
  return (
    <div className="route-arrival" data-waiting={waiting || undefined} aria-hidden="true">
      <span className="route-arrival-tab">{title}</span>
    </div>
  );
}

export function Topbar({ onOpenNav, navOpen = false }: { onOpenNav?: () => void; navOpen?: boolean }) {
  const { pathname } = useLocation();
  const reduce = useMotionPreference();
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
  const workspaceView = WORKSPACE_VIEWS.find((item) => item.path === pathname);
  const meta = pathname === "/welcome"
    ? WELCOME_META
    : workspaceView
      ? { title: workspaceView.title, description: workspaceView.description }
      : WELCOME_META;
  const online = Boolean(health?.llm.configured);
  const roleLabel = auth ? ROLE_LABELS[auth.role as UserRole] ?? auth.role : "";
  // 演示账号的 display_name 与角色标签同名，直接用登录名避免出现「管理员 / 管理员」两行重复
  const displayName = auth?.display_name || auth?.username || "";
  const chipName = displayName === roleLabel ? auth?.username || displayName : displayName;

  useEffect(() => {
    document.title = `${meta.title} · 研信智评`;
  }, [meta.title]);

  return (
    <header className={`topbar ${pathname === "/welcome" ? "" : "is-task"}`} onDragStart={(event) => event.preventDefault()}>
      <div className="topbar-title" key={`title:${pathname}`}>
        <h1>{meta.title}</h1>
        <p>{meta.description}</p>
        <div className="mobile-model-status" aria-label="当前模型配置">
          当前配置：{online && health ? modelLabel(health.llm) : "离线演示"}
        </div>
      </div>
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
              ? `当前配置：${health ? modelLabel(health.llm) : ""}；实际生成来源见每次结果`
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
              transition={{ duration: reduce ? 0 : MOTION.feedback, ease: EASE }}
            >
              {online && health ? modelLabel(health.llm) : "离线演示"}
            </motion.span>
          </AnimatePresence>
        </span>
        {can("upload") && (
          <motion.button
            className="btn btn-primary"
            onClick={() => openUpload()}
            aria-label="上传文档"
            whileTap={{ scale: 0.97 }}
            transition={{ duration: reduce ? 0 : MOTION.feedback, ease: EASE }}
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
                transition={reduce ? { duration: 0 } : SPRING}
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
      <RouteArrival key={`arrival:${pathname}`} title={meta.title} navOpen={navOpen} />
    </header>
  );
}
