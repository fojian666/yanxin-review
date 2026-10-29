import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
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
import { api } from "../api";
import { useApp } from "../AppContext";
import { currentWorkflowIndex, PROPOSAL_WORKFLOW } from "../data/proposalWorkflow";
import { EASE } from "../motion";
import type { Dossier, DossierChecklist } from "../types";
import { DossierModal } from "./DossierModal";
import { StatusPill } from "./StatusPill";

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
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
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
    if (proposal) setActiveDocId(proposal.doc_id);
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

  const verify = async (docId: string, checked: boolean) => {
    if (!dossier) return;
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
  const overallStatus = checklist?.overall.status ?? "warn";
  const workflowIndex = dossier ? currentWorkflowIndex(dossier.phase) : -1;

  return (
    <section className="panel dossier-workbench" aria-label="课题卷宗与材料体检">
      <header className="dossier-workbench-head">
        <div>
          <span className="dossier-kicker"><FolderOpen size={15} />卷宗编目</span>
          <h2>{dossier?.name ?? (dossiers.length ? "选择或新建课题卷宗" : "建立第一份课题卷宗")}</h2>
          <p>
            {dossier
              ? `${dossier.year ?? "年度未填"} · ${dossier.plan_type_label} · ${dossier.phase_label}`
              : dossiers.length ? "从工作区顶部选择已有卷宗，或新建一份课题卷宗。" : "将申请书、盖章件和后续材料归入同一课题，逐项核对缺项。"}
          </p>
        </div>
        <div className="dossier-workbench-actions">
          {dossier && can("upload") && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModalOpen(true)}>
              <Pencil size={14} />编辑卷宗
            </button>
          )}
        </div>
      </header>

      {!dossier ? (
        <div className="dossier-empty">
          <FilePlus2 size={28} aria-hidden="true" />
          <div>
            <strong>{dossiers.length ? "选择卷宗后查看材料体检" : "先建立卷宗，再做材料体检"}</strong>
            <p>登记课题后，可把现有文档归入申请书、盖章件、承诺书、合同和验收材料。</p>
          </div>
          {can("upload") && <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>新建课题卷宗</button>}
        </div>
      ) : (
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

          <details className="dossier-process">
            <summary>
              <span>课题实施流程</span>
              <strong>当前材料阶段：{dossier.phase_label}</strong>
            </summary>
            <ol>
              {PROPOSAL_WORKFLOW.map((stage, index) => (
                <li key={stage.key} className={index === workflowIndex ? "is-current" : ""}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{stage.label}</strong>
                    <p>{stage.summary}</p>
                    <small>{stage.materials.join(" · ")}</small>
                  </div>
                </li>
              ))}
            </ol>
            <p className="dossier-process-note">
              流程节点用于材料导航，不代表官方系统已受理、推荐、立项或验收。
            </p>
          </details>

          {can("upload") && (
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
          )}

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
                {currentMaterials.map((material) => {
                  const role = roles.find((item) => item.value === material.role);
                  const requiresVerification = Boolean(role?.requires_verification);
                  const operation = `verify-${material.doc_id}`;
                  return (
                    <div className="dossier-material-row" key={material.doc_id}>
                      <div className="dossier-material-copy">
                        <span className="dossier-role">{role?.short ?? material.role}</span>
                        <strong>{material.doc_name}</strong>
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
                            <label className="dossier-verify">
                              <input
                                type="checkbox"
                                checked={material.human_verified}
                                onChange={(event) => void verify(material.doc_id, event.target.checked)}
                                disabled={saving === operation}
                              />
                              <BadgeCheck size={14} />
                              人工确认
                            </label>
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
              <p className="dossier-inline-empty">尚无归卷材料。先上传文档，再从上方选择材料角色。</p>
            )}
          </div>

          {previousMaterials.length > 0 && (
            <details className="dossier-history">
              <summary>历史版本 · {previousMaterials.length} 份</summary>
              <div>
                {previousMaterials.map((material) => (
                  <div className="dossier-history-row" key={material.doc_id}>
                    <span>v{material.version} · {material.doc_name}</span>
                    {can("upload") && (
                      <button type="button" className="link-btn" onClick={() => void makeCurrent(material.doc_id)} disabled={saving === `current-${material.doc_id}`}>
                        设为当前
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

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
              <AnimatePresence initial={false}>
                <motion.div
                  className="dossier-check-sections"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.26, ease: EASE }}
                >
                  {checklist.sections.map((section) => (
                    <section className="dossier-check-section" key={section.key}>
                      <div className="dossier-check-head">
                        <h4>{section.title}</h4>
                        <StatusPill status={section.status} />
                      </div>
                      {section.items.map((item) => (
                        <div className="dossier-check-item" key={item.key}>
                          <span className={`dossier-check-dot status-${item.status}`} aria-hidden="true" />
                          <div>
                            <strong>{item.label}</strong>
                            <p>{item.detail}</p>
                            {item.evidence && <small>{item.evidence}</small>}
                          </div>
                          <StatusPill status={item.status} />
                        </div>
                      ))}
                    </section>
                  ))}
                  <div className="dossier-limitations">
                    <strong>检查边界</strong>
                    <ul>{checklist.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
                    <p>{checklist.disclaimer}</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            ) : loading ? (
              <div className="dossier-loading" role="status"><Loader2 size={18} className="spin" /> 正在生成材料体检…</div>
            ) : null}
          </div>
        </>
      )}

      <DossierModal
        open={modalOpen}
        dossier={dossier}
        onClose={() => setModalOpen(false)}
        onSaved={(next) => void saved(next)}
        onDeleted={() => {
          setChecklist(null);
          void refreshDossiers();
        }}
      />
    </section>
  );
}
