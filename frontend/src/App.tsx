import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "./AppContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { UploadModal } from "./components/UploadModal";
import { LoginPage } from "./pages/LoginPage";
import { WelcomePage } from "./pages/WelcomePage";
import { pageVariants, useMotionPreference } from "./motion";

function RouteEffects() {
  const { pathname } = useLocation();
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    const previous = lastPath.current;
    lastPath.current = pathname;
    // 首屏、StrictMode 重复挂载与 "/" 的初始重定向都不抢焦点，保证 skip link 仍是第一个 Tab 目标
    if (previous === null || previous === pathname) return;
    if (previous === "/" && pathname === "/welcome") return;
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}

function Shell() {
  const location = useLocation();
  const { auth, authReady, sidebarCollapsed } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [entering, setEntering] = useState(false);
  const hadVeil = useRef(false);
  const reduce = useMotionPreference();

  // 仅真实登录触发过渡：登录页写入一次性标记，会话恢复/刷新不出现。
  // useLayoutEffect 保证在欢迎页首次绘制前就盖上过渡层，避免闪一帧。
  useLayoutEffect(() => {
    if (!auth) return;
    let flag = "";
    try {
      flag = sessionStorage.getItem("yanxin.enter") || "";
      if (flag === "1") sessionStorage.removeItem("yanxin.enter");
    } catch {
      // 忽略存储异常
    }
    if (flag !== "1") return;
    document.documentElement.classList.add("entering");
    setEntering(true);
    return () => document.documentElement.classList.remove("entering");
  }, [auth]);

  // 品牌过渡短暂呈示，欢迎页就绪即撤幕；减少动态效果时不人为等待。
  useEffect(() => {
    if (!entering) return;
    hadVeil.current = true;
    const min = reduce ? 0 : 280;
    const start = performance.now();
    let timer = 0;
    const check = () => {
      const elapsed = performance.now() - start;
      const ready = Boolean(document.querySelector(".welcome-home"));
      if ((elapsed >= min && ready) || elapsed >= 1800) {
        document.documentElement.classList.remove("entering");
        setEntering(false);
      } else {
        timer = window.setTimeout(check, 40);
      }
    };
    timer = window.setTimeout(check, min);
    return () => window.clearTimeout(timer);
  }, [entering, reduce]);

  // 撤幕且 inert 解除后再把焦点交给主区
  useEffect(() => {
    if (entering || !hadVeil.current) return;
    hadVeil.current = false;
    const raf = requestAnimationFrame(() => {
      document.getElementById("main")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [entering]);

  useEffect(() => setNavOpen(false), [location.pathname]);

  // 会话失效时收起抽屉，避免登录页残留滚动锁与遮罩
  useEffect(() => {
    if (!auth) setNavOpen(false);
  }, [auth]);

  useEffect(() => {
    if (!navOpen) return;
    const mq = window.matchMedia("(min-width: 681px)");
    const onChange = () => { if (mq.matches) setNavOpen(false); };
    mq.addEventListener("change", onChange);
    // html 才是实际滚动容器（scrollbar-gutter），必须同时锁 html 与 body
    const root = document.documentElement;
    const body = document.body;
    const prevRoot = root.style.overflow;
    const prevBody = body.style.overflow;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      mq.removeEventListener("change", onChange);
      root.style.overflow = prevRoot;
      body.style.overflow = prevBody;
    };
  }, [navOpen]);

  if (!authReady) {
    return (
      <div className="app-splash">
        <span className="spinner" />
        正在验证登录状态…
      </div>
    );
  }
  if (!auth) {
    return <LoginPage />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <span className="sr-only" role="status" aria-live="polite">
        {entering ? "正在进入评审工作台" : ""}
      </span>
      <div
        className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${navOpen ? "nav-open" : ""}`}
        inert={entering || undefined}
        aria-hidden={entering || undefined}
      >
        <a className="skip-link" href="#main">跳到主要内容</a>
        <Sidebar navOpen={navOpen} onClose={() => setNavOpen(false)} />
        {navOpen && (
          <button
            type="button"
            className="nav-scrim"
            aria-label="关闭导航"
            onClick={() => setNavOpen(false)}
          />
        )}
        <main className="main" id="main" tabIndex={-1}>
          <Topbar onOpenNav={() => setNavOpen(true)} navOpen={navOpen} />
          <RouteEffects />
          <motion.div
            className="page"
            variants={pageVariants}
            initial={reduce ? false : "initial"}
            animate="animate"
          >
            <ErrorBoundary resetKey={location.pathname}>
              <Suspense
                fallback={
                  <div className="page-skeleton" role="status">
                    <span className="sr-only">正在加载工作区…</span>
                    <div className="skeleton skeleton-title" aria-hidden="true" />
                    <div className="skeleton" aria-hidden="true" />
                    <div className="skeleton-grid" aria-hidden="true"><div className="skeleton" /><div className="skeleton" /></div>
                  </div>
                }
              >
                <Routes location={location}>
                  <Route path="/" element={<Navigate to="/welcome" replace />} />
                  <Route path="*" element={<WelcomePage />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </motion.div>
        </main>
        <UploadModal />
      </div>
      <AnimatePresence>
        {entering && (
          <motion.div
            className="enter-veil"
            aria-hidden="true"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}
          >
            <div className="enter-veil-inner">
              <span className="enter-seal" aria-hidden="true">研</span>
              <strong>研信智评</strong>
              <span className="enter-sub">正在进入评审工作台</span>
              <span className="enter-line" aria-hidden="true" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </AppProvider>
  );
}
