import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider } from "./AppContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { UploadModal } from "./components/UploadModal";
import { ChatPage } from "./pages/ChatPage";
import { pageVariants } from "./motion";

const TrendPage = lazy(() => import("./pages/TrendPage").then((m) => ({ default: m.TrendPage })));
const ReviewPage = lazy(() => import("./pages/ReviewPage").then((m) => ({ default: m.ReviewPage })));
const MatchPage = lazy(() => import("./pages/MatchPage").then((m) => ({ default: m.MatchPage })));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}

function Shell() {
  const location = useLocation();
  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
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
