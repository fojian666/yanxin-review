import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { lazy, Suspense, useEffect } from "react";
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

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}

function Shell() {
  const location = useLocation();
  const { auth, authReady, sidebarCollapsed } = useApp();

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
      <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <Sidebar />
        <main className="main">
          <Topbar />
          <ScrollToTop />
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
                    <Route path="/match" element={<MatchPage />} />
                    <Route path="/review" element={<ReviewPage />} />
                    <Route path="/library" element={<LibraryPage />} />
                    <Route path="/admin" element={<AdminPage />} />
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
