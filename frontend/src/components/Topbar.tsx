import { motion } from "framer-motion";
import { Check, LogOut, Menu, Palette, Upload, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { WORKSPACE_VIEWS } from "../data/workspaceViews";
import { ROLE_LABELS, type UserRole } from "../types";
import { EASE, SPRING, MOTION, useMotionPreference } from "../motion";
import { setTheme, themes, useTheme } from "../theme";

const WELCOME_META = { title: "工作台", description: "围绕当前卷宗连续办理" };

export function Topbar({ onOpenNav, navOpen = false }: { onOpenNav?: () => void; navOpen?: boolean }) {
  const { pathname } = useLocation();
  const reduce = useMotionPreference();
  const { auth, openUpload, can, logout } = useApp();
  const [userOpen, setUserOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  useEffect(() => {
    if (!themeOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!themeRef.current?.contains(event.target as Node)) setThemeOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setThemeOpen(false);
        themeRef.current?.querySelector<HTMLButtonElement>(".theme-trigger")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [themeOpen]);

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
        <div className="theme-menu" ref={themeRef}>
          <button type="button" className="theme-trigger btn btn-ghost" aria-label="切换主题" aria-expanded={themeOpen} aria-controls="theme-options" onClick={() => setThemeOpen(open => !open)}>
            <Palette size={17} /><span>主题</span>
          </button>
          {themeOpen && <div className="theme-options" id="theme-options" role="group" aria-label="选择主题">
            {themes.map(item => <label key={item.id} className="theme-option">
              <input type="radio" name="theme" value={item.id} checked={theme === item.id} onChange={() => setTheme(item.id)} />
              <span className={`theme-swatch theme-swatch-${item.id}`} aria-hidden="true" />
              <span>{item.label}</span>
              {theme === item.id && <Check size={15} aria-hidden="true" />}
            </label>)}
          </div>}
        </div>
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
    </header>
  );
}
