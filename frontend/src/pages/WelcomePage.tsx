import { AnimatePresence, motion } from "framer-motion";
import { FolderKanban, MessageSquareText, ShieldCheck } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { WorkspaceRouteLoader } from "../components/WorkspaceRouteLoader";
import { visibleWorkspaceViews, type WorkspaceView } from "../data/workspaceViews";
import { pageVariants, useMotionPreference, useSessionEntrance } from "../motion";
import { ROLE_LABELS, type UserRole } from "../types";

function TaskWorkspace({ view, reduce }: { view: WorkspaceView; reduce: boolean }) {
  const [readyPath, setReadyPath] = useState<string | null>(null);
  const routeReady = readyPath === view.path;
  const SelectedPanel = view.component;

  useEffect(() => {
    if (routeReady) return;
    let cancelled = false;
    let timer = 0;
    const started = performance.now();
    void view.component.preload().catch(() => {
      // 预取失败后仍交给懒加载组件和错误边界呈现最终错误。
    }).finally(() => {
      const remaining = Math.max(0, 180 - (performance.now() - started));
      timer = window.setTimeout(() => {
        if (!cancelled) setReadyPath(view.path);
      }, remaining);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [routeReady, view.component, view.path]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={view.path}
        className="workspace-stage-body"
        variants={pageVariants}
        initial={reduce ? false : "initial"}
        animate="animate"
        exit={reduce ? { opacity: 1, transition: { duration: 0 } } : "exit"}
      >
        {routeReady
          ? (
              <Suspense fallback={<WorkspaceRouteLoader title={view.title} icon={view.icon} />}>
                <SelectedPanel />
              </Suspense>
            )
          : <WorkspaceRouteLoader title={view.title} icon={view.icon} />}
      </motion.div>
    </AnimatePresence>
  );
}

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
    setChatMessages,
    setChatCitations,
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
  const isOverview = location.pathname === "/welcome";
  const selectWorkspaceDocument = (nextDocId: string) => {
    setSelectedDocs(nextDocId ? [nextDocId] : []);
    setChatMessages([]);
    setChatCitations([]);
  };

  return (
    <div className={`welcome-home workspace-home ${location.pathname === "/welcome" ? "is-overview" : "is-task"}`}>
      <motion.section className={`workspace-ledger ${unfold ? "is-unfolding" : ""}`} aria-label="历史课题工作区">
        <div className="workspace-ledger-main">
        <div className="welcome-greeting-row">
          <h2>{greeting()}，{name}</h2>
          {showBadge && <span className={`role-badge role-${auth?.role}`}>{role}</span>}
        </div>
        <div className="workspace-document-row">
          <label htmlFor="workspace-document">当前课题</label>
          {dossiers.length ? (
            <select
              id="workspace-document"
              className="select"
              title={selectedDossier?.name || ""}
              value={activeDossierId || (activeDocId ? `doc:${activeDocId}` : "")}
              onChange={(event) => {
                const nextId = event.target.value;
                if (nextId.startsWith("doc:")) {
                  const nextDocId = nextId.slice(4);
                  setActiveDossierId("");
                  setActiveDocId(nextDocId);
                  selectWorkspaceDocument(nextDocId);
                  return;
                }
                setActiveDossierId(nextId);
                const proposal = dossiers
                  .find((dossier) => dossier.id === nextId)
                  ?.materials.find((material) => material.role === "proposal_text" && material.is_current);
                const nextDocId = proposal?.doc_id ?? "";
                setActiveDocId(nextDocId);
                selectWorkspaceDocument(nextDocId);
              }}
            >
              <option value="">选择历史课题</option>
              <optgroup label="历史课题">
                {dossiers.map((dossier) => (
                  <option key={dossier.id} value={dossier.id}>
                    {dossier.name}
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
              onChange={(event) => {
                const nextDocId = event.target.value;
                setActiveDocId(nextDocId);
                selectWorkspaceDocument(nextDocId);
              }}
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
            onClick={() => {
              if (primaryPath === "/chat") selectWorkspaceDocument(activeDocId);
            }}
          >
            {can("review") ? <><ShieldCheck size={16} />预审当前课题</> : <><MessageSquareText size={16} />用当前课题提问</>}
          </Link>
        </div>}
        </div>
        <div className="workspace-register" role="group" aria-label="历史课题和文档概况">
          <div>
            <strong>{loading ? "读取中" : docs.length}</strong>
            <span>在册文档</span>
          </div>
          <div>
            <strong>{loading ? "读取中" : dossiers.length}</strong>
            <span>历史课题</span>
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

      <div className="workspace-stage">
        {isOverview ? (
          <section className="workspace-overview-deck" aria-label="当前工作面提示">
            <div className="workspace-overview-mark" aria-hidden="true"><FolderKanban size={22} /></div>
            <div>
              <span>当前课题已载入</span>
              <strong>{selectedDossier?.name ?? selectedDoc?.name ?? "尚未选择资料"}</strong>
            </div>
          </section>
        ) : (
          <TaskWorkspace view={active} reduce={reduce} />
        )}
      </div>

      <p className="welcome-disclaimer">
        结果只提供检查项与证据，不替代人工判断。
      </p>
    </div>
  );
}
