import { AnimatePresence, motion } from "framer-motion";
import { MessageSquareText, ShieldCheck } from "lucide-react";
import { Suspense } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { visibleWorkspaceViews } from "../data/workspaceViews";
import { EASE, pageVariants, useMotionPreference, useSessionEntrance } from "../motion";
import { ROLE_LABELS, type UserRole } from "../types";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "上午好";
  if (hour < 14) return "午间好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function WelcomePage() {
  const {
    auth,
    can,
    docs,
    dossiers,
    loading,
    activeDocId,
    setActiveDocId,
    activeDossierId,
    setActiveDossierId,
    setSelectedDocs,
  } = useApp();
  const location = useLocation();
  const reduce = useMotionPreference();
  const unfold = useSessionEntrance("yanxin.dossier-entrance");
  const entries = visibleWorkspaceViews(can);
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
  const selectedDossier = dossiers.find((dossier) => dossier.id === activeDossierId);
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
          <label htmlFor="workspace-document">{dossiers.length ? "当前课题卷宗" : "当前卷宗"}</label>
          {dossiers.length ? (
            <select
              id="workspace-document"
              className="select"
              title={selectedDossier?.name || ""}
              value={activeDossierId || (activeDocId ? `doc:${activeDocId}` : "")}
              onChange={(event) => {
                const nextId = event.target.value;
                if (nextId.startsWith("doc:")) {
                  setActiveDossierId("");
                  setActiveDocId(nextId.slice(4));
                  return;
                }
                setActiveDossierId(nextId);
                const proposal = dossiers
                  .find((dossier) => dossier.id === nextId)
                  ?.materials.find((material) => material.role === "proposal_text" && material.is_current);
                setActiveDocId(proposal?.doc_id ?? "");
              }}
            >
              <option value="">选择课题卷宗</option>
              <optgroup label="课题卷宗">
                {dossiers.map((dossier) => (
                  <option key={dossier.id} value={dossier.id}>
                    {dossier.name} · {dossier.plan_type_label} · {dossier.phase_label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="单独的申报书">
                {docs.filter((doc) => doc.kind === "proposal" || doc.kind === "other").map((doc) => (
                  <option key={doc.id} value={`doc:${doc.id}`}>{doc.name}</option>
                ))}
              </optgroup>
            </select>
          ) : (
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
          )}
        </div>
        {location.pathname === "/welcome" && <div className="welcome-actions">
          <Link
            className="btn btn-primary"
            to={primaryPath}
            onClick={() => { if (primaryPath === "/chat" && activeDocId) setSelectedDocs([activeDocId]); }}
          >
            {can("review") ? <><ShieldCheck size={16} />预审当前卷宗</> : <><MessageSquareText size={16} />用此卷宗提问</>}
          </Link>
        </div>}
        </div>
        <div className="workspace-register" role="group" aria-label="卷宗和文档概况">
          <div>
            <strong>{loading ? "读取中" : docs.length}</strong>
            <span>在册文档</span>
          </div>
          <div>
            <strong>{loading ? "读取中" : dossiers.length}</strong>
            <span>课题卷宗</span>
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
