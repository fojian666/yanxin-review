import { AnimatePresence, motion } from "framer-motion";
import {
  FolderOpen,
  MessageSquareText,
  ShieldCheck,
  TrendingUp,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { EASE, pageVariants, useMotionPreference, useSessionEntrance } from "../motion";
import { ROLE_LABELS, type UserRole } from "../types";

const ChatPanel = lazy(() => import("./ChatPage").then((module) => ({ default: module.ChatPage })));
const TrendPanel = lazy(() => import("./TrendPage").then((module) => ({ default: module.TrendPage })));
const MatchPanel = lazy(() => import("./MatchPage").then((module) => ({ default: module.MatchPage })));
const ReviewPanel = lazy(() => import("./ReviewPage").then((module) => ({ default: module.ReviewPage })));
const LibraryPanel = lazy(() => import("./LibraryPage").then((module) => ({ default: module.LibraryPage })));
const AdminPanel = lazy(() => import("./AdminPage").then((module) => ({ default: module.AdminPage })));

interface WorkspaceView {
  path: string;
  title: string;
  icon: LucideIcon;
  permission?: string;
  component: LazyExoticComponent<ComponentType>;
}

const WORKSPACE_VIEWS: WorkspaceView[] = [
  { path: "/review", title: "本子预审", icon: ShieldCheck, permission: "review", component: ReviewPanel },
  { path: "/match", title: "查重匹配", icon: Users, permission: "tool", component: MatchPanel },
  { path: "/chat", title: "智能问答", icon: MessageSquareText, component: ChatPanel },
  { path: "/trend", title: "文献趋势", icon: TrendingUp, component: TrendPanel },
  { path: "/library", title: "文档库", icon: FolderOpen, component: LibraryPanel },
  { path: "/admin", title: "用户管理", icon: UserCog, permission: "admin", component: AdminPanel },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "上午好";
  if (hour < 14) return "午间好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function WelcomePage() {
  const { auth, can, docs, loading, openUpload, activeDocId, setActiveDocId, setSelectedDocs } = useApp();
  const location = useLocation();
  const reduce = useMotionPreference();
  const unfold = useSessionEntrance("yanxin.dossier-entrance");
  const entries = WORKSPACE_VIEWS.filter((item) => !item.permission || can(item.permission));
  const defaultPath = can("review") ? "/review" : "/chat";
  const requested = entries.find((item) => item.path === location.pathname);
  if (location.pathname !== "/welcome" && !requested) {
    return <Navigate to={can("review") ? "/chat" : defaultPath} replace />;
  }
  const active = requested ?? entries.find((item) => item.path === defaultPath) ?? entries[0];
  if (!active) return <Navigate to="/" replace />;
  const activeIndex = entries.findIndex((item) => item.path === active.path);
  const SelectedPanel = active.component;
  const proposalCount = docs.filter((doc) => doc.kind === "proposal").length;
  const policyCount = docs.filter((doc) => doc.kind === "policy").length;
  const selectedDoc = docs.find((doc) => doc.id === activeDocId);
  const role = auth ? ROLE_LABELS[auth.role as UserRole] : "";
  const display = auth?.display_name || auth?.username || "";
  const named = Boolean(display) && display !== role;
  const name = named ? display : role;
  const showBadge = named && Boolean(role);
  const primaryPath = can("review") ? "/review" : "/chat";

  return (
    <div className={`welcome-home workspace-home ${location.pathname === "/welcome" ? "is-overview" : "is-task"}`}>
      <motion.section className={`workspace-ledger ${unfold ? "is-unfolding" : ""}`} aria-label="卷宗工作区">
        <div className="workspace-ledger-main">
        <div className="welcome-greeting-row">
          <h2>{greeting()}，{name}</h2>
          {showBadge && <span className={`role-badge role-${auth?.role}`}>{role}</span>}
        </div>
        <div className="workspace-document-row">
          <label htmlFor="workspace-document">当前卷宗</label>
          <select
            id="workspace-document"
            className="select"
            title={selectedDoc?.name || ""}
            value={activeDocId}
            onChange={(event) => setActiveDocId(event.target.value)}
          >
            <option value="">从资料库选择申报书</option>
            {docs.filter((doc) => doc.kind === "proposal" || doc.kind === "other").map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
          </select>
        </div>
        <div className="welcome-actions">
          <Link
            className="btn btn-primary"
            to={primaryPath}
            onClick={() => { if (primaryPath === "/chat" && activeDocId) setSelectedDocs([activeDocId]); }}
          >
            {can("review") ? <><ShieldCheck size={16} />预审当前卷宗</> : <><MessageSquareText size={16} />用此卷宗提问</>}
          </Link>
          {can("upload") && <button className="btn btn-ghost" type="button" onClick={() => openUpload()}>上传新卷宗</button>}
        </div>
        </div>
        <div className="workspace-register" role="group" aria-label="资料库概况">
          <div>
            <strong>{loading ? "读取中" : docs.length}</strong>
            <span>在册资料</span>
          </div>
          <div>
            <strong>{proposalCount}</strong>
            <span>申报书</span>
          </div>
          <div>
            <strong>{policyCount}</strong>
            <span>政策</span>
          </div>
        </div>
      </motion.section>

      <nav className="welcome-entries workspace-index" aria-label="工作区功能">
        {entries.map(({ path, title, icon: Icon }, index) => {
          const isActive = index === activeIndex;
          return (
            <Link
              key={path}
              className={`workspace-tab ${isActive ? "is-active" : ""}`}
              to={path}
              aria-current={isActive ? "page" : undefined}
              onClick={() => { if (path === "/chat" && activeDocId) setSelectedDocs([activeDocId]); }}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{title}</span>
              {isActive && <motion.span className="workspace-tab-marker" layoutId="workspace-tab-marker" transition={{ duration: reduce ? 0 : 0.2, ease: EASE }} />}
            </Link>
          );
        })}
      </nav>

      <div className="workspace-stage">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active.path}
            className="workspace-stage-body"
            variants={pageVariants}
            initial={reduce ? false : "initial"}
            animate="animate"
            exit={reduce ? { opacity: 1, transition: { duration: 0 } } : "exit"}
          >
            <Suspense
              fallback={
                <div className="page-skeleton" role="status">
                  <span className="sr-only">正在加载工作区…</span>
                  <div className="skeleton skeleton-title" aria-hidden="true" />
                  <div className="skeleton" aria-hidden="true" />
                </div>
              }
            >
              <SelectedPanel />
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="welcome-disclaimer">
        结果只提供检查项与证据，不替代人工判断。
      </p>
    </div>
  );
}
