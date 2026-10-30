import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../AppContext";
import { currentWorkflowIndex, PROPOSAL_WORKFLOW } from "../data/proposalWorkflow";
import { EASE } from "../motion";
import type { Dossier, DossierChecklist } from "../types";
import { DossierModal } from "./DossierModal";
import { StatusPill } from "./StatusPill";
import { InlinePager, WorkDeck } from "./WorkDeck";

type DossierSection = "overview" | "materials" | "attach" | "history" | "checklist" | "workflow" | "limitations";

const DOSSIER_STEPS: Array<{ id: DossierSection; label: string; hint: string }> = [
  { id: "overview", label: "卷宗概况", hint: "课题与当前进度" },
  { id: "materials", label: "卷宗材料", hint: "查看当前材料" },
  { id: "attach", label: "归入资料", hint: "选择文档和角色" },
  { id: "history", label: "历史版本", hint: "版本与当前稿" },
  { id: "checklist", label: "材料体检", hint: "逐项核对证据" },
  { id: "workflow", label: "课题流程", hint: "定位当前阶段" },
  { id: "limitations", label: "检查边界", hint: "人工复核范围" },
];

export function DossierWorkbench() {
  const {
    activeDossierId,
    setActiveDossierId,
    setActiveDocId,
    dossiers,
    dossierOptions,
    docs,
    can,
    refreshDossiers,
    openUpload,
    toast,
  } = useApp();
  const [checklist, setChecklist] = useState<DossierChecklist | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [section, setSection] = useState<DossierSection>("overview");
  const [materialPage, setMaterialPage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [checkPage, setCheckPage] = useState(0);
  const [workflowPage, setWorkflowPage] = useState(0);
  const [limitPage, setLimitPage] = useState(0);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState("");
  const [selectedRole, setSelectedRole] = useState("proposal_text");
  const [saving, setSaving] = useState("");
  const checklistRequest = useRef(0);

  const dossier = dossiers.find((item) => item.id === activeDossierId) ?? null;
  useEffect(() => {
    setMaterialPage(0); setHistoryPage(0); setCheckPage(0); setWorkflowPage(0); setLimitPage(0);
  }, [activeDossierId]);
  const availableDocs = useMemo(() => {
    const attached = new Set(dossier?.materials.map((item) => item.doc_id) ?? []);
    return docs.filter(
      (doc) =>
        !attached.has(doc.id) &&
        ["proposal", "paper", "other"].includes(doc.kind)
    );
  }, [docs, dossier]);

  useEffect(() => {
    if (!availableDocs.some((doc) => doc.id === selectedDoc)) {
      setSelectedDoc(availableDocs[0]?.id ?? "");
    }
  }, [availableDocs, selectedDoc]);

  const loadChecklist = async () => {
    const requestId = ++checklistRequest.current;
    if (!activeDossierId) {
      setChecklist(null);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setChecklist((current) =>
      current?.dossier.id === activeDossierId ? current : null
    );
    try {
      const result = await api.dossierChecklist(activeDossierId);
      if (requestId === checklistRequest.current) setChecklist(result);
    } catch (err) {
      if (requestId === checklistRequest.current) setError((err as Error).message);
    } finally {
      if (requestId === checklistRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadChecklist();
    // dossier.updated_at changes after each association or verification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDossierId, dossier?.updated_at]);

  const chooseDossier = (next: Dossier) => {
    setActiveDossierId(next.id);
    const proposal = next.materials.find(
      (material) => material.role === "proposal_text" && material.is_current
    );
    setActiveDocId(proposal?.doc_id ?? "");
  };

  const saved = async (next: Dossier) => {
    await refreshDossiers();
    chooseDossier(next);
  };

  const attach = async () => {
    if (!dossier || !selectedDoc || !selectedRole) return;
    setSaving("attach");
    try {
      await api.attachDossierDocument(dossier.id, selectedDoc, selectedRole);
      await refreshDossiers();
      await loadChecklist();
      if (selectedRole === "proposal_text") setActiveDocId(selectedDoc);
      toast("资料已归入卷宗");
    } catch (err) {
      toast(`归档失败：${(err as Error).message}`, "error");
    } finally {
      setSaving("");
    }
  };

  const verify = async (docId: string, name: string, checked: boolean) => {
    if (!dossier) return;
    const confirmed = confirm(
      checked
        ? `确认已人工核对《${name}》的盖章、签字和材料状态？`
        : `撤销对《${name}》的人工确认记录？`
    );
    if (!confirmed) return;
    setSaving(`verify-${docId}`);
    try {
      await api.updateDossierDocument(dossier.id, docId, { human_verified: checked });
      await refreshDossiers();
      await loadChecklist();
      toast(checked ? "已记录人工确认" : "已撤销人工确认");
    } catch (err) {
      toast(`更新失败：${(err as Error).message}`, "error");
    } finally {
      setSaving("");
    }
  };

  const makeCurrent = async (docId: string) => {
    if (!dossier) return;
    setSaving(`current-${docId}`);
    try {
      await api.updateDossierDocument(dossier.id, docId, { is_current: true });
      if (dossier.materials.find((item) => item.doc_id === docId)?.role === "proposal_text") setActiveDocId(docId);
      await refreshDossiers();
      await loadChecklist();
      toast("已切换当前版本");
    } catch (err) {
      toast(`切换失败：${(err as Error).message}`, "error");
    } finally {
      setSaving("");
    }
  };

  const detach = async (docId: string, name: string) => {
    if (!dossier || !confirm(`确定将《${name}》从卷宗材料中移除？文档本身不会被删除。`)) return;
    setSaving(`detach-${docId}`);
    try {
      await api.detachDossierDocument(dossier.id, docId);
      if (dossier.materials.some((item) => item.doc_id === docId && item.role === "proposal_text" && item.is_current)) setActiveDocId("");
      await refreshDossiers();
      await loadChecklist();
      toast("已从卷宗材料中移除");
    } catch (err) {
      toast(`移除失败：${(err as Error).message}`, "error");
    } finally {
      setSaving("");
    }
  };

  const roles = dossierOptions?.material_roles ?? [];
  const currentMaterials = dossier?.materials.filter((item) => item.is_current) ?? [];
  const previousMaterials = dossier?.materials.filter((item) => !item.is_current) ?? [];
  const checks = checklist?.sections.flatMap((group) => group.items.map((item) => ({ group, item }))) ?? [];
  const materialIndex = Math.min(materialPage, Math.max(0, currentMaterials.length - 1));
  const historyIndex = Math.min(historyPage, Math.max(0, previousMaterials.length - 1));
  const checkIndex = Math.min(checkPage, Math.max(0, checks.length - 1));
  const limits = checklist ? [...checklist.limitations, checklist.disclaimer] : [];
  const limitIndex = Math.min(limitPage, Math.max(0, limits.length - 1));
  const overallStatus = checklist?.overall.status ?? "warn";
  const workflowIndex = dossier ? currentWorkflowIndex(dossier.phase) : -1;
  const dossierSteps = DOSSIER_STEPS.filter((step) => step.id !== "attach" || can("upload"));

  return (
    <section className={`panel dossier-workbench ${expanded ? "is-expanded" : "is-collapsed"}`} aria-label="课题卷宗与材料体检">
      <header className="dossier-workbench-head">
        <div>
          <span className="dossier-kicker"><FolderOpen size={15} />卷宗编目</span>
          <h2 title={dossier?.name}>{dossier?.name ?? (dossiers.length ? "选择或新建课题卷宗" : "建立第一份课题卷宗")}</h2>
          <p>
            {dossier
              ? `${dossier.year ?? "年度未填"} · ${dossier.plan_type_label} · ${dossier.phase_label}`
              : dossiers.length ? "从工作区顶部选择已有卷宗，或新建一份课题卷宗。" : "将申请书、盖章件和后续材料归入同一课题，逐项核对缺项。"}
          </p>
        </div>
        <div className="dossier-workbench-actions">
          {dossier && <button type="button" className="btn btn-ghost btn-sm" aria-label={expanded ? "收起详情" : "展开详情"} aria-expanded={expanded} aria-controls="dossier-details" onClick={() => setExpanded((value) => !value)}>
            <span>{expanded ? "收起详情" : "展开详情"}</span><ChevronDown size={14} className={expanded ? "dossier-chevron is-expanded" : "dossier-chevron"} />
          </button>}
          {dossier && can("upload") && (
            <button type="button" className="btn btn-ghost btn-sm" aria-label="编辑卷宗" onClick={() => { setEditing(true); setModalOpen(true); }}>
              <Pencil size={14} /><span>编辑卷宗</span>
            </button>
          )}
          {dossier && can("upload") && <button type="button" className="btn btn-primary btn-sm" aria-label="新建课题卷宗" onClick={() => { setEditing(false); setModalOpen(true); }}><Plus size={14} /><span>新建课题卷宗</span></button>}
        </div>
      </header>

      {!dossier ? (
        <div className="dossier-empty">
          <FilePlus2 size={28} aria-hidden="true" />
          <div>
            <strong>{dossiers.length ? "选择卷宗后查看材料体检" : "先建立卷宗，再做材料体检"}</strong>
            <p>登记课题后，可把现有文档归入申请书、盖章件、承诺书、合同和验收材料。</p>
          </div>
          {can("upload") && <button type="button" className="btn btn-primary" onClick={() => { setEditing(false); setModalOpen(true); }}>新建课题卷宗</button>}
        </div>
      ) : (
        <WorkDeck
          id="dossier-details"
          className="dossier-deck"
          hidden={!expanded}
          steps={dossierSteps}
          active={section}
          onChange={setSection}
          ariaLabel="卷宗办理"
          status={<StatusPill status={overallStatus} />}
          panels={{
            overview: (
              <>
                <div className="dossier-overview">
                  <div>
                    <span>当前材料</span>
                    <strong>{dossier.current_material_count}</strong>
                  </div>
                  <div>
                    <span>已人工确认</span>
                    <strong>{dossier.verified_material_count}</strong>
                  </div>
                  <div>
                    <span>材料阶段</span>
                    <strong>{dossier.phase_label}</strong>
                  </div>
                  <div className="dossier-overall">
                    <span>本阶段体检</span>
                    <StatusPill status={overallStatus} />
                  </div>
                </div>
                <div className="dossier-overview-note">
                  <span>办理范围</span>
                  <p>材料清单用于核对本地归卷情况；盖章、签字和主管部门状态仍需人工确认。</p>
                </div>
              </>
            ),
            materials: (
              <div className="dossier-materials">
                <div className="dossier-section-title">
                  <div>
                    <h3>当前材料</h3>
                    <span>{currentMaterials.length} 份</span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadChecklist()} disabled={loading}>
                    <RefreshCw size={13} className={loading ? "spin" : ""} />刷新体检
                  </button>
                </div>
                {currentMaterials.length ? (
                  <div className="dossier-material-list">
                    {currentMaterials.slice(materialIndex, materialIndex + 1).map((material) => {
                      const role = roles.find((item) => item.value === material.role);
                      const requiresVerification = Boolean(role?.requires_verification);
                      const operation = `verify-${material.doc_id}`;
                      return (
                        <div className="dossier-material-row" key={material.doc_id}>
                          <div className="dossier-material-copy">
                            <span className="dossier-role">{role?.short ?? material.role}</span>
                            <strong title={material.doc_name}><Link className="evidence-doc-link" to={`/library?doc=${encodeURIComponent(material.doc_id)}`} aria-label={`打开《${material.doc_name}》原文`}>{material.doc_name}</Link></strong>
                            <small>
                              v{material.version}
                              {material.doc_suffix ? ` · ${material.doc_suffix.replace(".", "").toUpperCase()}` : ""}
                              {material.human_verified && material.verified_by
                                ? ` · ${material.verified_by} 已确认`
                                : ""}
                            </small>
                          </div>
                          {can("upload") && (
                            <div className="dossier-material-actions">
                              {requiresVerification && (
                                <button
                                  type="button"
                                  className={`dossier-verify${material.human_verified ? " is-confirmed" : ""}`}
                                  aria-pressed={material.human_verified}
                                  aria-label={`${material.human_verified ? "撤销" : "确认"}《${material.doc_name}》人工核验`}
                                  onClick={() => void verify(material.doc_id, material.doc_name, !material.human_verified)}
                                  disabled={saving === operation}
                                >
                                  <BadgeCheck size={14} />
                                  {material.human_verified ? "撤销确认" : "人工确认"}
                                </button>
                              )}
                              <button type="button" className="icon-btn" aria-label={`移除 ${material.doc_name}`} onClick={() => void detach(material.doc_id, material.doc_name)}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="dossier-inline-empty">尚无归卷材料。先进入“归入资料”，选择文档和材料角色。</p>
                )}
                <InlinePager label="材料" index={materialIndex} total={currentMaterials.length} onChange={setMaterialPage} />
              </div>
            ),
            attach: can("upload") ? (
              <div className="dossier-attach">
                <div>
                  <span>归入现有资料</span>
                  <p>新版本归入同一材料角色后会自动成为当前版本。</p>
                </div>
                {availableDocs.length ? (
                  <div className="dossier-attach-controls">
                    <select className="select" value={selectedDoc} onChange={(event) => setSelectedDoc(event.target.value)} aria-label="选择要归卷的资料">
                      {availableDocs.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                    </select>
                    <select className="select" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)} aria-label="材料角色">
                      {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void attach()} disabled={saving === "attach"}>
                      {saving === "attach" ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
                      归入卷宗
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openUpload()}>
                    <Plus size={14} />上传并准备归卷
                  </button>
                )}
              </div>
            ) : null,
            history: previousMaterials.length > 0 ? (
              <div className="dossier-history">
                <strong>历史版本 · {previousMaterials.length} 份</strong>
                <div>
                  {previousMaterials.slice(historyIndex, historyIndex + 1).map((material) => (
                    <div className="dossier-history-row" key={material.doc_id}>
                      <span>v{material.version} · <Link className="evidence-doc-link" to={`/library?doc=${encodeURIComponent(material.doc_id)}`} aria-label={`打开《${material.doc_name}》历史版本原文`}>{material.doc_name}</Link></span>
                      {can("upload") && (
                        <button type="button" className="link-btn" onClick={() => void makeCurrent(material.doc_id)} disabled={saving === `current-${material.doc_id}`}>
                          设为当前
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <InlinePager label="历史版本" index={historyIndex} total={previousMaterials.length} onChange={setHistoryPage} />
              </div>
            ) : <p className="dossier-inline-empty">暂无历史版本。</p>,
            checklist: (
              <div className="dossier-checklist">
                <div className="dossier-section-title">
                  <div>
                    <h3><ShieldCheck size={17} />材料体检</h3>
                    <span>{checklist?.overall.summary ?? (loading ? "正在检查…" : "等待检查")}</span>
                  </div>
                </div>
                {error ? (
                  <div className="dossier-error" role="alert">
                    卷宗体检读取失败：{error}
                    <button type="button" className="link-btn" onClick={() => void loadChecklist()}>重试</button>
                  </div>
                ) : checklist ? (
                  <AnimatePresence initial={false} mode="wait">
                    {checks.slice(checkIndex, checkIndex + 1).map(({ group, item }) => (
                      <motion.section
                        className="dossier-check-section"
                        key={`${group.key}:${item.key}`}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -3 }}
                        transition={{ duration: 0.18, ease: EASE }}
                      >
                        <div className="dossier-check-head">
                          <h4>{group.title}</h4>
                          <StatusPill status={group.status} />
                        </div>
                        <div className="dossier-check-item">
                          <span className={`dossier-check-dot status-${item.status}`} aria-hidden="true" />
                          <div>
                            <strong>{item.label}</strong>
                            <p>{item.detail}</p>
                            {item.evidence && <small>{item.evidence}</small>}
                          </div>
                          <StatusPill status={item.status} />
                        </div>
                      </motion.section>
                    ))}
                  </AnimatePresence>
                ) : loading ? (
                  <div className="dossier-loading" role="status"><Loader2 size={18} className="spin" /> 正在生成材料体检…</div>
                ) : null}
                <InlinePager label="体检项目" index={checkIndex} total={checks.length} onChange={setCheckPage} />
              </div>
            ),
            workflow: (
              <div className="dossier-process">
                <div className="dossier-process-summary">
                  <span>课题实施流程</span>
                  <strong>当前材料阶段：{dossier.phase_label}</strong>
                </div>
                <ol>
                  {PROPOSAL_WORKFLOW.slice(workflowPage, workflowPage + 1).map((stage) => (
                    <li key={stage.key} className={workflowPage === workflowIndex ? "is-current" : ""}>
                      <span>{String(workflowPage + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{stage.label}</strong>
                        <p>{stage.summary}</p>
                        <small>{stage.materials.join(" · ")}</small>
                      </div>
                    </li>
                  ))}
                </ol>
                <InlinePager label="流程" index={workflowPage} total={PROPOSAL_WORKFLOW.length} onChange={setWorkflowPage} />
                <p className="dossier-process-note">
                  流程节点用于材料导航，不代表官方系统已受理、推荐、立项或验收。
                </p>
              </div>
            ),
            limitations: checklist
              ? <div className="dossier-limitations"><strong>检查边界</strong><p>{limits[limitIndex]}</p><InlinePager label="检查边界" index={limitIndex} total={limits.length} onChange={setLimitPage} /></div>
              : <p className="dossier-inline-empty">材料体检生成后，在这里查看检查边界。</p>,
          }}
        />
      )}

      <DossierModal
        open={modalOpen}
        dossier={editing ? dossier : null}
        onClose={() => setModalOpen(false)}
        onSaved={(next) => void saved(next)}
        onDeleted={() => {
          setChecklist(null);
          setActiveDossierId("");
          setActiveDocId("");
          void refreshDossiers();
        }}
      />
    </section>
  );
}
