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
import type { Dossier, DossierChecklist } from "../types";
import { AdaptivePager } from "./AdaptivePager";
import { DossierModal } from "./DossierModal";
import { StatusPill } from "./StatusPill";
import { WorkDeck } from "./WorkDeck";

type DossierSection = "overview" | "materials" | "attach" | "history" | "checklist" | "workflow" | "limitations";

const DOSSIER_STEPS: Array<{ id: DossierSection; label: string; hint: string }> = [
  { id: "overview", label: "课题概况", hint: "历史课题与当前进度" },
  { id: "materials", label: "课题材料", hint: "查看当前材料" },
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
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState("");
  const [selectedRole, setSelectedRole] = useState("proposal_text");
  const [saving, setSaving] = useState("");
  const checklistRequest = useRef(0);

  const dossier = dossiers.find((item) => item.id === activeDossierId) ?? null;
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
      toast("资料已归入历史课题");
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
    if (!dossier || !confirm(`确定将《${name}》从历史课题材料中移除？文档本身不会被删除。`)) return;
    setSaving(`detach-${docId}`);
    try {
      await api.detachDossierDocument(dossier.id, docId);
      if (dossier.materials.some((item) => item.doc_id === docId && item.role === "proposal_text" && item.is_current)) setActiveDocId("");
      await refreshDossiers();
      await loadChecklist();
      toast("已从历史课题材料中移除");
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
  const limits = checklist
    ? [
        ...checklist.limitations.map((text, index) => ({
          key: `limit:${index}`,
          label: `检查边界 ${String(index + 1).padStart(2, "0")}`,
          text,
        })),
        { key: "disclaimer", label: "免责声明", text: checklist.disclaimer },
      ]
    : [];
  const overallStatus = checklist?.overall.status ?? "warn";
  const workflowIndex = dossier ? currentWorkflowIndex(dossier.phase) : -1;
  const dossierSteps = DOSSIER_STEPS.filter((step) => step.id !== "attach" || can("upload"));

  return (
    <section className={`panel dossier-workbench ${expanded ? "is-expanded" : "is-collapsed"}`} aria-label="历史课题与材料体检">
      <header className="dossier-workbench-head">
        <div>
          <span className="dossier-kicker"><FolderOpen size={15} />历史课题编目</span>
          <h2 title={dossier?.name}>{dossier?.name ?? (dossiers.length ? "选择或新建历史课题" : "建立第一份历史课题")}</h2>
          <p>
            {dossier
              ? `${dossier.year ?? "年度未填"} · ${dossier.plan_type_label} · ${dossier.phase_label}`
              : dossiers.length ? "从工作区顶部选择已有历史课题，或新建一份历史课题。" : "将申请书、盖章件和后续材料归入同一历史课题，逐项核对缺项。"}
          </p>
        </div>
        <div className="dossier-workbench-actions">
          {dossier && <button type="button" className="btn btn-ghost btn-sm" aria-label={expanded ? "收起详情" : "展开详情"} aria-expanded={expanded} aria-controls="dossier-details" onClick={() => setExpanded((value) => !value)}>
            <span>{expanded ? "收起详情" : "展开详情"}</span><ChevronDown size={14} className={expanded ? "dossier-chevron is-expanded" : "dossier-chevron"} />
          </button>}
          {dossier && can("upload") && (
            <button type="button" className="btn btn-ghost btn-sm" aria-label="编辑历史课题" onClick={() => { setEditing(true); setModalOpen(true); }}>
              <Pencil size={14} /><span>编辑历史课题</span>
            </button>
          )}
          {dossier && can("upload") && <button type="button" className="btn btn-primary btn-sm" aria-label="新建历史课题" onClick={() => { setEditing(false); setModalOpen(true); }}><Plus size={14} /><span>新建历史课题</span></button>}
        </div>
      </header>

      {!dossier ? (
        <div className="dossier-empty">
          <FilePlus2 size={28} aria-hidden="true" />
          <div>
            <strong>{dossiers.length ? "选择历史课题后查看材料体检" : "先建立历史课题，再做材料体检"}</strong>
            <p>登记课题后，可把现有文档归入申请书、盖章件、承诺书、合同和验收材料。</p>
          </div>
          {can("upload") && <button type="button" className="btn btn-primary" onClick={() => { setEditing(false); setModalOpen(true); }}>新建历史课题</button>}
        </div>
      ) : (
        <WorkDeck
          id="dossier-details"
          className="dossier-deck"
          hidden={!expanded}
          steps={dossierSteps}
          active={section}
          onChange={setSection}
          ariaLabel="历史课题办理"
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
                  <AdaptivePager
                    className="dossier-material-list"
                    label="材料"
                    items={currentMaterials}
                    resetKey={activeDossierId}
                    getKey={(material) => material.doc_id}
                    renderItem={(material) => {
                      const role = roles.find((item) => item.value === material.role);
                      const requiresVerification = Boolean(role?.requires_verification);
                      const operation = `verify-${material.doc_id}`;
                      return (
                        <div className="dossier-material-row">
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
                    }}
                  />
                ) : (
                  <p className="dossier-inline-empty">尚无归卷材料。先进入“归入资料”，选择文档和材料角色。</p>
                )}
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
                      归入历史课题
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
                <AdaptivePager
                  className="dossier-history-list"
                  label="历史版本"
                  items={previousMaterials}
                  resetKey={activeDossierId}
                  getKey={(material) => material.doc_id}
                  renderItem={(material) => (
                    <div className="dossier-history-row">
                      <span>v{material.version} · <Link className="evidence-doc-link" to={`/library?doc=${encodeURIComponent(material.doc_id)}`} aria-label={`打开《${material.doc_name}》历史版本原文`}>{material.doc_name}</Link></span>
                      {can("upload") && (
                        <button type="button" className="link-btn" onClick={() => void makeCurrent(material.doc_id)} disabled={saving === `current-${material.doc_id}`}>
                          设为当前
                        </button>
                      )}
                    </div>
                  )}
                />
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
                    课题体检读取失败：{error}
                    <button type="button" className="link-btn" onClick={() => void loadChecklist()}>重试</button>
                  </div>
                ) : checklist ? (
                  <AdaptivePager
                    className="dossier-check-sections"
                    label="体检项目"
                    items={checks}
                    resetKey={`${activeDossierId}:${checklist.overall.generated_at}`}
                    getKey={({ group, item }) => `${group.key}:${item.key}`}
                    renderItem={({ group, item }) => (
                      <section className="dossier-check-section">
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
                      </section>
                    )}
                  />
                ) : loading ? (
                  <div className="dossier-loading" role="status"><Loader2 size={18} className="spin" /> 正在生成材料体检…</div>
                ) : null}
              </div>
            ),
            workflow: (
              <div className="dossier-process">
                <div className="dossier-process-summary">
                  <span>课题实施流程</span>
                  <strong>当前材料阶段：{dossier.phase_label}</strong>
                </div>
                <AdaptivePager
                  className="dossier-process-list"
                  label="流程"
                  items={PROPOSAL_WORKFLOW}
                  resetKey={activeDossierId}
                  getKey={(stage) => stage.key}
                  renderItem={(stage, index) => (
                    <article className={`dossier-process-stage${index === workflowIndex ? " is-current" : ""}`}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{stage.label}</strong>
                        <p>{stage.summary}</p>
                        <small>{stage.materials.join(" · ")}</small>
                      </div>
                    </article>
                  )}
                />
                <p className="dossier-process-note">
                  流程节点用于材料导航，不代表官方系统已受理、推荐、立项或验收。
                </p>
              </div>
            ),
            limitations: checklist
              ? (
                  <AdaptivePager
                    className="dossier-limitations"
                    label="检查边界"
                    items={limits}
                    resetKey={`${activeDossierId}:${checklist.overall.generated_at}`}
                    getKey={(item) => item.key}
                    renderItem={(item) => (
                      <article className="dossier-boundary-item">
                        <strong>{item.label}</strong>
                        <p>{item.text}</p>
                      </article>
                    )}
                  />
                )
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
