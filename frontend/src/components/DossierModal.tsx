import { AnimatePresence, motion } from "framer-motion";
import { Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { useApp } from "../AppContext";
import type { Dossier, DossierPhase, DossierPlanType } from "../types";

interface DossierModalProps {
  open: boolean;
  dossier?: Dossier | null;
  onClose: () => void;
  onSaved: (dossier: Dossier) => void;
  onDeleted: () => void;
}

export function DossierModal({ open, dossier, onClose, onSaved, onDeleted }: DossierModalProps) {
  const { dossierOptions, toast } = useApp();
  const [name, setName] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [planType, setPlanType] = useState<DossierPlanType>("directive");
  const [phase, setPhase] = useState<DossierPhase>("application");
  const [applicantUnit, setApplicantUnit] = useState("");
  const [leader, setLeader] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<0 | 1>(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    setName(dossier?.name ?? "");
    setYear(dossier?.year ? String(dossier.year) : String(new Date().getFullYear()));
    setPlanType(dossier?.plan_type ?? "directive");
    setPhase(dossier?.phase ?? "application");
    setApplicantUnit(dossier?.applicant_unit ?? "");
    setLeader(dossier?.leader ?? "");
    setSupervisor(dossier?.supervisor ?? "");
    setBusy(false);
    setStep(0);
  }, [dossier, open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const focusables = () =>
      Array.from(
        card?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => element.offsetParent !== null);
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!card?.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === card)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const root = document.documentElement;
    const body = document.body;
    const oldRoot = root.style.overflow;
    const oldBody = body.style.overflow;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      if (!card?.contains(document.activeElement)) card?.focus({ preventScroll: true });
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = oldRoot;
      body.style.overflow = oldBody;
      previous?.focus();
    };
  }, [open]);

  const validateBasic = () => {
    if (!name.trim()) {
      toast("请填写课题名称", "error");
      return false;
    }
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear) || parsedYear < 1990 || parsedYear > 2035) {
      toast("申报年度需在 1990–2035 之间", "error");
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!validateBasic()) { setStep(0); return; }
    const parsedYear = Number(year);
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        year: parsedYear,
        plan_type: planType,
        phase,
        applicant_unit: applicantUnit.trim(),
        leader: leader.trim(),
        supervisor: supervisor.trim(),
      };
      const result = dossier
        ? await api.updateDossier(dossier.id, payload)
        : await api.createDossier(payload);
      onSaved(result.dossier);
      toast(dossier ? "历史课题信息已更新" : "历史课题已建立");
      onClose();
    } catch (err) {
      toast(`保存失败：${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!dossier || !confirm(`确定删除历史课题《${dossier.name}》？课题文档不会被删除。`)) return;
    setBusy(true);
    try {
      await api.deleteDossier(dossier.id);
      toast("历史课题已删除，课题文档仍保留");
      onDeleted();
      onClose();
    } catch (err) {
      toast(`删除失败：${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="modal-backdrop" onClick={() => !busy && onClose()} />
          <motion.div
            ref={cardRef}
            className="modal-card dossier-modal"
            role="dialog"
            aria-modal="true"
            aria-label={dossier ? "编辑历史课题" : "新建历史课题"}
            tabIndex={-1}
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <div className="modal-head">
              <div>
                <h2>{dossier ? "编辑历史课题" : "建立历史课题"}</h2>
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭" disabled={busy}>
                <X size={18} />
              </button>
            </div>
            <div className="dossier-form-step" aria-live="polite">{step === 0 ? "1 / 2 · 课题信息" : "2 / 2 · 单位与负责人"}</div>
            <div className="form-grid" hidden={step !== 0}>
              <label className="field span-2">
                <span>课题名称</span>
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} />
              </label>
              <label className="field">
                <span>申报年度</span>
                <input
                  type="number"
                  min={1990}
                  max={2035}
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                />
              </label>
              <label className="field">
                <span>计划类型</span>
                <select
                  value={planType}
                  onChange={(event) => setPlanType(event.target.value as DossierPlanType)}
                >
                  {(dossierOptions?.plan_types ?? [
                    { value: "directive", label: "指令性" },
                    { value: "guidance", label: "指导性" },
                  ]).map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>材料阶段</span>
                <select value={phase} onChange={(event) => setPhase(event.target.value as DossierPhase)}>
                  {(dossierOptions?.phases ?? [
                    { value: "application", label: "申报准备" },
                    { value: "implementation", label: "实施材料" },
                    { value: "acceptance", label: "验收材料" },
                    { value: "closing", label: "结题备案" },
                  ]).map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid" hidden={step !== 1}>
              <label className="field">
                <span>课题负责人（可选）</span>
                <input value={leader} onChange={(event) => setLeader(event.target.value)} maxLength={80} />
              </label>
              <label className="field span-2">
                <span>申报 / 承担单位（可选）</span>
                <input value={applicantUnit} onChange={(event) => setApplicantUnit(event.target.value)} maxLength={160} />
              </label>
              <label className="field span-2">
                <span>申报单位主管部门（建议填写）</span>
                <input value={supervisor} onChange={(event) => setSupervisor(event.target.value)} maxLength={160} />
              </label>
            </div>
            <p className="dossier-modal-note">
              这里登记的是本地材料阶段，不表示官方系统已受理或审批。
            </p>
            <div className="modal-actions">
              {dossier && (
                <button type="button" className="btn btn-ghost dossier-delete" onClick={() => void remove()} disabled={busy}>
                  <Trash2 size={15} />删除历史课题
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
              {step === 1 && <button type="button" className="btn btn-ghost" onClick={() => setStep(0)} disabled={busy}>上一步</button>}
              {step === 0 ? <button type="button" className="btn btn-primary" onClick={() => { if (validateBasic()) setStep(1); }} disabled={busy}>下一步</button> :
                <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? "保存中…" : "保存历史课题"}</button>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
