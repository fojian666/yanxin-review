import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "./AppContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { UploadModal } from "./components/UploadModal";
import { ChatPage } from "./pages/ChatPage";
import { LoginPage } from "./pages/LoginPage";
import { pageVariants } from "./motion";

const TrendPage = lazy(() => import("./pages/TrendPage").then((m) => ({ default: m.TrendPage })));
const ReviewPage = lazy(() => import("./pages/ReviewPage").then((m) => ({ default: m.ReviewPage })));
const MatchPage = lazy(() => import("./pages/MatchPage").then((m) => ({ default: m.MatchPage })));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));

function RouteEffects() {
  const { pathname } = useLocation();
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    const previous = lastPath.current;
    lastPath.current = pathname;
    // 首屏、StrictMode 重复挂载与 "/" 的初始重定向都不抢焦点，保证 skip link 仍是第一个 Tab 目标
    if (previous === null || previous === pathname) return;
    if (previous === "/" && pathname === "/chat") return;
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}

function Shell() {
  const location = useLocation();
  const { auth, authReady, sidebarCollapsed, can } = useApp();
  const [navOpen, setNavOpen] = useState(false);

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
      <a className="skip-link" href="#main">跳到主要内容</a>
      <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${navOpen ? "nav-open" : ""}`}>
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
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              className="page"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <ErrorBoundary resetKey={location.pathname}>
                <Suspense
                  fallback={
                    <div className="page-loading">
                      <span className="spinner" />
                      加载视图…
                    </div>
                  }
                >
                  <Routes location={location}>
                    <Route path="/chat" element={<ChatPage />} />
                    <Route path="/trend" element={<TrendPage />} />
                    <Route
                      path="/match"
                      element={can("tool") ? <MatchPage /> : <Navigate to="/chat" replace />}
                    />
                    <Route
                      path="/review"
                      element={can("review") ? <ReviewPage /> : <Navigate to="/chat" replace />}
                    />
                    <Route path="/library" element={<LibraryPage />} />
                    <Route
                      path="/admin"
                      element={can("admin") ? <AdminPage /> : <Navigate to="/chat" replace />}
                    />
                    <Route path="*" element={<Navigate to="/chat" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
        <UploadModal />
      </div>
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
