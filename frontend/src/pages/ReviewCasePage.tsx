import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../AppContext";
import { EmptyState } from "../components/EmptyState";
import { KpiCard } from "../components/KpiCard";
import { WorkDeck, type WorkDeckStep } from "../components/WorkDeck";
import type {
  ExpertCandidate,
  ReviewCase,
  ReviewDecision,
  ReviewerOption,
  ReviewReport,
  ToolCheckResult,
} from "../types";

type FlowStage = "pre_review" | "expert_review" | "final_review";

const FLOW_STEPS: WorkDeckStep<FlowStage>[] = [
  { id: "pre_review", label: "预审", hint: "规则、查重与专家候选" },
  { id: "expert_review", label: "专家审核", hint: "回避、指派与意见" },
  { id: "final_review", label: "终审", hint: "汇总意见并作出决定" },
];

const DECISION_OPTIONS: { value: ReviewDecision; label: string }[] = [
  { value: "approved", label: "通过" },
  { value: "returned", label: "退回修改" },
  { value: "deferred", label: "暂缓" },
  { value: "rejected", label: "不通过" },
];

const REVIEW_PROGRESS_STEPS = {
  pre: ["读取申报书结构", "核对诚信与规范", "执行查重与政策检索", "生成专家候选", "写入预审归档"],
  final: ["汇总专家意见", "校验回避与完成状态", "写入终审决定", "完成归档保存"],
} as const;

function ReviewProgress({ mode, current }: { mode: "pre" | "final"; current: number }) {
  const steps = REVIEW_PROGRESS_STEPS[mode];
  const active = Math.min(current, steps.length - 1);
  const percent = Math.min(92, Math.round(((active + 1) / steps.length) * 100));
  return (
    <div className="review-process-progress" role="status" aria-live="polite">
      <div className="review-process-orbit" aria-hidden="true">
        <span />
        <span />
        <strong>{active + 1}</strong>
      </div>
      <div className="review-process-copy">
        <small>{mode === "pre" ? "预审进行中" : "终审签署中"}</small>
        <h3>{steps[active]}</h3>
        <div className="review-process-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
        <ol>
          {steps.map((step, index) => (
            <li key={step} className={index < active ? "is-done" : index === active ? "is-active" : ""}>
              <span>{String(index + 1).padStart(2, "0")}</span>{step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function stageForCase(value: ReviewCase) {
  if (value.stage === "completed") return "final_review";
  if (value.stage === "pre_review" || value.stage === "expert_review" || value.stage === "final_review") return value.stage;
  return "pre_review";
}

function taskStatusClass(status: string) {
  if (status === "submitted") return "status-pass";
  if (status === "conflict") return "status-warn";
  return "status-idle";
}

export function ReviewCasePage() {
  const { docs, dossiers, toast, activeDocId } = useApp();
  const [params, setParams] = useSearchParams();
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [current, setCurrent] = useState<ReviewCase | null>(null);
  const [reviewers, setReviewers] = useState<ReviewerOption[]>([]);
  const [caseId, setCaseId] = useState(params.get("case") || "");
  const selectedCaseRef = useRef(caseId);
  const [stage, setStage] = useState<FlowStage>("pre_review");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDossierId, setCreateDossierId] = useState("");
  const [createDocId, setCreateDocId] = useState("");
  const [selectedExperts, setSelectedExperts] = useState<number[]>([]);
  const [assignee, setAssignee] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>("approved");
  const [finalComment, setFinalComment] = useState("");

  const [processStep, setProcessStep] = useState(0);

  const availableDocs = useMemo(
    () => docs.filter((doc) => doc.kind === "proposal" || doc.kind === "other"),
    [docs]
  );
  const toolResult = useMemo(
    () =>
      current?.artifacts?.find((artifact) => artifact.artifact_type === "tool_check")
        ?.payload as unknown as ToolCheckResult | undefined,
    [current]
  );
  const preReview = useMemo(
    () =>
      current?.artifacts?.find((artifact) => artifact.artifact_type === "pre_review")
        ?.payload as unknown as ReviewReport | undefined,
    [current]
  );
  const candidates = toolResult?.match?.candidates ?? [];
  const excludedCount = toolResult?.match?.excluded?.length ?? 0;

  useEffect(() => {
    if (busy !== "pre" && busy !== "final") {
      setProcessStep(0);
      return;
    }
    setProcessStep(0);
    const steps = REVIEW_PROGRESS_STEPS[busy];
    const timer = window.setInterval(() => {
      setProcessStep((current) => Math.min(current + 1, steps.length - 1));
    }, 720);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    let active = true;
    void Promise.all([api.reviewCases(), api.reviewCaseReviewers()])
      .then(([caseResult, reviewerResult]) => {
        if (!active) return;
        setCases(caseResult.cases);
        setReviewers(reviewerResult.reviewers);
        setAssignee(reviewerResult.reviewers[0]?.username || "");
        const requested = params.get("case");
        const next = caseResult.cases.find((item) => item.id === requested)?.id
          || caseResult.cases[0]?.id
          || "";
        selectedCaseRef.current = next;
        setCaseId(next);
        if (!caseResult.cases.length) {
          setCreating(true);
          setCreateDocId(availableDocs.find((doc) => doc.id === activeDocId)?.id || availableDocs[0]?.id || "");
        }
      })
      .catch((error) => toast(`评审案卷加载失败：${(error as Error).message}`, "error"))
      .finally(() => setLoading(false));
    return () => { active = false; };
    // Initial data load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (creating || createDocId || !availableDocs.length) return;
    setCreateDocId(availableDocs.find((doc) => doc.id === activeDocId)?.id || availableDocs[0].id);
  }, [activeDocId, availableDocs, createDocId, creating]);

  useEffect(() => {
    if (!caseId) {
      setCurrent(null);
      return;
    }
    let active = true;
    setCurrent(null);
    setSelectedExperts([]);
    setDecision("approved");
    setFinalComment("");
    setStage("pre_review");
    setProcessStep(0);
    setLoading(true);
    void api.reviewCase(caseId)
      .then((result) => {
        if (!active) return;
        setCurrent(result.case);
        setStage(stageForCase(result.case));
        setFinalComment(result.case.final_comment || "");
        setDecision(result.case.final_decision || "approved");
        const nextParams = new URLSearchParams(params);
        nextParams.set("case", result.case.id);
        setParams(nextParams, { replace: true });
      })
      .catch((error) => toast(`案卷读取失败：${(error as Error).message}`, "error"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // caseId is the sole reload key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const applyCase = async (next: ReviewCase, targetStage: FlowStage = stageForCase(next), created = false) => {
    setCases((items) => {
      const exists = items.some((item) => item.id === next.id);
      return exists ? items.map((item) => item.id === next.id ? next : item) : [next, ...items];
    });
    if (created || selectedCaseRef.current === next.id) {
      selectedCaseRef.current = next.id;
      setCurrent(next);
      setStage(targetStage);
      setCaseId(next.id);
    }
  };

  const createCase = async () => {
    if (!createDocId) {
      toast("请选择申报书或项目材料", "error");
      return;
    }
    setBusy("create");
    try {
      const result = await api.createReviewCase({
        title: createTitle.trim(),
        doc_id: createDocId,
        dossier_id: createDossierId,
      });
      await applyCase(result.case, stageForCase(result.case), true);
      setCreating(false);
      setCreateTitle("");
      setCreateDossierId("");
      toast("评审案卷已建立");
    } catch (error) {
      toast(`建立案卷失败：${(error as Error).message}`, "error");
    } finally {
      setBusy("");
    }
  };

  const runPreReview = async () => {
    if (!current) return;
    setBusy("pre");
    try {
      const result = await api.runReviewCase(current.id);
      await applyCase(result.case, "pre_review");
      toast("预审、查重和专家匹配已完成并归档");
    } catch (error) {
      toast(`预审失败：${(error as Error).message}`, "error");
    } finally {
      setBusy("");
    }
  };

  const toggleExpert = (id: number) => {
    setSelectedExperts((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id]
    );
  };

  const assignExperts = async () => {
    if (!current || !selectedExperts.length || !assignee) {
      toast("请选择审核账号和候选专家", "error");
      return;
    }
    setBusy("assign");
    try {
      const result = await api.assignReviewCaseExperts(
        current.id,
        selectedExperts.map((expert_id) => ({ expert_id, username: assignee }))
      );
      await applyCase(result.case);
      if (selectedCaseRef.current === result.case.id) setSelectedExperts([]);
      toast(`已指派 ${selectedExperts.length} 位专家`);
    } catch (error) {
      toast(`专家指派失败：${(error as Error).message}`, "error");
    } finally {
      setBusy("");
    }
  };

  const advanceFinal = async () => {
    if (!current) return;
    setBusy("advance");
    try {
      const result = await api.advanceReviewCaseFinal(current.id);
      await applyCase(result.case);
      toast("专家意见已齐备，进入终审");
    } catch (error) {
      toast(`无法进入终审：${(error as Error).message}`, "error");
    } finally {
      setBusy("");
    }
  };

  const submitFinal = async () => {
    if (!current) return;
    if (!confirm("终审决定签署后将归档且不可覆盖，确认继续？")) return;
    setBusy("final");
    try {
      const result = await api.finalizeReviewCase(current.id, decision, finalComment);
      await applyCase(result.case);
      toast("终审决定已签署并归档");
    } catch (error) {
      toast(`终审提交失败：${(error as Error).message}`, "error");
    } finally {
      setBusy("");
    }
  };

  const reloadCurrent = async () => {
    if (!current) return;
    try {
      const result = await api.reviewCase(current.id);
      await applyCase(result.case);
    } catch (error) {
      toast(`案卷刷新失败：${(error as Error).message}`, "error");
    }
  };

  const chooseStage = (next: FlowStage) => {
    if (next === "expert_review" && current?.stage === "pre_review") {
      toast("请先完成预审", "error");
      return;
    }
    if (next === "final_review" && !["final_review", "completed"].includes(current?.stage || "")) {
      toast("请先完成专家审核并进入终审", "error");
      return;
    }
    setStage(next);
  };

  const selectDossier = (dossierId: string) => {
    setCreateDossierId(dossierId);
    const dossier = dossiers.find((item) => item.id === dossierId);
    if (!dossier) return;
    setCreateTitle(dossier.name);
    const proposal = dossier.materials.find((material) => material.role === "proposal_text" && material.is_current)
      || dossier.materials.find((material) => material.is_current);
    if (proposal) setCreateDocId(proposal.doc_id);
  };

  if (loading && !current) {
    return <div className="panel review-case-loading"><Loader2 className="spin" size={20} />正在读取评审案卷…</div>;
  }

  if (creating || !current) {
    return (
      <div className="review-case-workspace">
        <section className="panel review-case-intake">
          <div className="review-case-intake-head">
            <span className="review-case-intake-icon"><ClipboardCheck size={22} /></span>
            <div>
              <h2>建立项目评审案卷</h2>
              <p>选择申报书后，系统将按预审、专家审核、终审连续推进。</p>
            </div>
          </div>
          <div className="review-case-intake-grid">
            <label className="field">
              <span>关联历史课题（可选）</span>
              <select value={createDossierId} onChange={(event) => selectDossier(event.target.value)}>
                <option value="">不关联历史课题</option>
                {dossiers.map((dossier) => <option key={dossier.id} value={dossier.id}>{dossier.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>申报书 / 项目材料</span>
              <select value={createDocId} onChange={(event) => {
                setCreateDocId(event.target.value);
                const doc = availableDocs.find((item) => item.id === event.target.value);
                if (doc && !createTitle) setCreateTitle(doc.name);
              }}>
                <option value="">请选择</option>
                {availableDocs.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
              </select>
            </label>
            <label className="field span-2">
              <span>案卷名称</span>
              <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder="留空则使用申报书或课题名称" />
            </label>
          </div>
          <div className="review-case-intake-actions">
            {cases.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>取消</button>}
            <button type="button" className="btn btn-primary" onClick={() => void createCase()} disabled={busy === "create" || !createDocId}>
              {busy === "create" ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              建立并开始
            </button>
          </div>
        </section>
      </div>
    );
  }

  const tasks = current.tasks ?? [];
  return (
    <div className="review-case-workspace">
      <section className="review-case-bar">
        <div>
          <span>项目评审案卷</span>
          <strong>{current.title}</strong>
        </div>
        <div className="review-case-bar-actions">
          <select className="select" value={current.id} onChange={(event) => { selectedCaseRef.current = event.target.value; setCaseId(event.target.value); }} aria-label="切换评审案卷">
            {cases.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.stage_label}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(true)}><Plus size={14} />新建案卷</button>
        </div>
      </section>

      <WorkDeck
        className="review-case-deck"
        steps={FLOW_STEPS}
        active={stage}
        onChange={chooseStage}
        ariaLabel="项目评审流程"
        status={current.final_decision_label || current.stage_label}
        panels={{
          pre_review: (
            <div className="review-stage-page">
              <div className="review-stage-heading">
                <div>
                  <span>第 1 阶段</span>
                  <h2>预审与证据准备</h2>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void runPreReview()}
                  disabled={busy === "pre" || current.stage !== "pre_review"}
                >
                  {busy === "pre" ? <Loader2 className="spin" size={16} /> : <FileSearch size={16} />}
                  {current.stage === "pre_review" ? "一键预审并匹配专家" : "重新运行需新建轮次"}
                </button>
              </div>
              {busy === "pre" ? (
                <ReviewProgress mode="pre" current={processStep} />
              ) : preReview ? (
                <>
                  <div className="kpi-grid review-case-kpis">
                    <KpiCard label="风险等级" value={preReview.overall.risk_level} sub={`${preReview.overall.checked_items} 项检查`} tone={preReview.overall.risk_level === "高" ? "gold" : "teal"} />
                    <KpiCard label="文本规模" value={preReview.doc.char_count} suffix="字" sub={`${preReview.doc.chunk_count} 个文本块`} />
                    <KpiCard label="查重命中" value={toolResult?.duplicate.matches.length ?? 0} suffix="个" sub={toolResult?.duplicate.summary || "已完成"} />
                    <KpiCard label="候选专家" value={candidates.length} suffix="位" sub={`已排除 ${excludedCount} 位`} tone="gold" />
                  </div>
                  <div className="review-stage-grid">
                    <article className="review-stage-card">
                      <h3>预审结论</h3>
                      <p>{preReview.overall.summary}</p>
                      <div className="review-case-boundaries scroll-area">
                        {toolResult?.match.applicant_warning && (
                          <div className="review-case-boundary-warning" role="status">
                            <AlertTriangle size={15} aria-hidden="true" />
                            <span>{toolResult.match.applicant_warning}</span>
                          </div>
                        )}
                        {toolResult?.match.institution_match_note && (
                          <p><strong>单位比对口径：</strong>{toolResult.match.institution_match_note}</p>
                        )}
                        {(preReview.limitations?.length ?? 0) > 0 && (
                          <p><strong>能力边界：</strong>{preReview.limitations?.join("；")}</p>
                        )}
                        <small>{preReview.disclaimer}</small>
                        {toolResult?.disclaimer && <small>{toolResult.disclaimer}</small>}
                      </div>
                    </article>
                    <article className="review-stage-card review-stage-questions">
                      <h3>待核实问题</h3>
                      {(preReview.questions || []).slice(0, 6).map((question) => <p key={question}><span>{question}</span></p>)}
                    </article>
                  </div>
                </>
              ) : (
                <EmptyState icon={<FileSearch size={38} />} description="一键执行形式检查、查重和专家候选匹配，结果会同时写入案卷与文档中心。" />
              )}
            </div>
          ),
          expert_review: (
            <div className="review-stage-page">
              <div className="review-stage-heading">
                <div>
                  <span>第 2 阶段</span>
                  <h2>专家候选与独立审核</h2>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void advanceFinal()}
                  disabled={busy === "advance" || current.stage !== "expert_review" || current.assigned_count > 0 || current.submitted_count === 0}
                >
                  {busy === "advance" ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}
                  进入终审
                </button>
              </div>
              <div className="review-expert-stage-grid">
                <article className="review-stage-card review-candidate-pool">
                  <div className="review-stage-card-head">
                    <div><h3>候选专家</h3><small>选择专家后指派给一个审核账号</small></div>
                    <Users size={18} />
                  </div>
                  <div className="review-candidate-list">
                    {candidates.slice(0, 8).map((candidate: ExpertCandidate) => (
                      <label key={candidate.expert.id} className={selectedExperts.includes(candidate.expert.id) ? "is-selected" : ""}>
                        <input
                          type="checkbox"
                          checked={selectedExperts.includes(candidate.expert.id)}
                          disabled={current.stage !== "expert_review"}
                          onChange={() => toggleExpert(candidate.expert.id)}
                        />
                        <span>
                          <strong>{candidate.expert.name}</strong>
                          <small>{candidate.expert.institution} · {candidate.expert.title}</small>
                        </span>
                        <em>{Math.round((candidate.relative_score ?? candidate.score) * 100)}</em>
                      </label>
                    ))}
                  </div>
                  <div className="review-assign-row">
                    <select className="select" value={assignee} onChange={(event) => setAssignee(event.target.value)} aria-label="选择专家审核账号">
                      {reviewers.map((reviewer) => <option key={reviewer.username} value={reviewer.username}>{reviewer.display_name}</option>)}
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void assignExperts()} disabled={busy === "assign" || current.stage !== "expert_review" || !selectedExperts.length || !assignee}>
                      {busy === "assign" ? <Loader2 className="spin" size={14} /> : <UserPlus size={14} />}指派审核
                    </button>
                  </div>
                </article>
                <article className="review-stage-card">
                  <div className="review-stage-card-head">
                    <div><h3>专家任务</h3><small>{current.submitted_count}/{current.task_total} 已提交</small></div>
                    <button type="button" className="icon-btn" aria-label="刷新专家任务" onClick={() => void reloadCurrent()}><RefreshCw size={15} /></button>
                  </div>
                  {tasks.length ? (
                    <div className="review-task-list scroll-area">
                      {tasks.map((task) => (
                        <div className="review-task-row" key={task.id}>
                          <span className={`status-pill ${taskStatusClass(task.status)}`}>{task.status_label}</span>
                          <div>
                            <strong>{task.expert_name}</strong>
                            <small>{task.expert_institution} · 审核账号 {task.assignee_username}</small>
                            {task.admin_debug && <small className="review-admin-debug">管理员 {task.submitted_by} 调试代提交</small>}
                          </div>
                          {task.recommendation_label && <em>{task.recommendation_label}</em>}
                        </div>
                      ))}
                    </div>
                  ) : <EmptyState icon={<Users size={30} />} description="尚未指派专家。" />}
                </article>
              </div>
            </div>
          ),
          final_review: (
            <div className="review-stage-page">
              <div className="review-stage-heading">
                <div><span>第 3 阶段</span><h2>意见汇总与终审</h2></div>
                {current.stage === "completed" && (
                  <span className="status-pill status-pass">
                    <CheckCircle2 size={14} aria-hidden="true" />
                    <span>{current.final_decision_label}</span>
                  </span>
                )}
              </div>
              {busy === "final" ? (
                <ReviewProgress mode="final" current={processStep} />
              ) : <div className="review-final-grid">
                <article className="review-stage-card">
                  <h3>专家意见汇总</h3>
                  <div className="review-opinion-list scroll-area">
                    {tasks.filter((task) => task.status === "submitted").map((task) => (
                      <div key={task.id} className="review-opinion-item">
                        <div><strong>{task.expert_name}</strong><span>{task.recommendation_label}</span></div>
                        <p>{task.opinion}</p>
                        {task.admin_debug && <small className="review-admin-debug">管理员 {task.submitted_by} 调试代提交</small>}
                      </div>
                    ))}
                    {current.conflict_count > 0 && <p className="review-conflict-note">另有 {current.conflict_count} 位专家已声明回避，原因已留痕。</p>}
                  </div>
                </article>
                <article className="review-stage-card review-final-form">
                  {current.stage === "completed" ? (
                    <>
                      <h3>终审决定</h3>
                      <strong className="review-final-decision">{current.final_decision_label}</strong>
                      <p>{current.final_comment}</p>
                    </>
                  ) : current.stage === "final_review" ? (
                    <>
                      <h3>填写终审决定</h3>
                      <div className="review-decision-options">
                        {DECISION_OPTIONS.map((item) => (
                          <label key={item.value} className={decision === item.value ? "is-selected" : ""}>
                            <input type="radio" name="decision" value={item.value} checked={decision === item.value} onChange={() => setDecision(item.value)} />
                            {item.label}
                          </label>
                        ))}
                      </div>
                      <textarea value={finalComment} onChange={(event) => setFinalComment(event.target.value)} placeholder="填写终审理由、修改要求或通过条件（至少 10 字）" />
                      <button type="button" className="btn btn-primary" onClick={() => void submitFinal()} disabled={busy === "final" || finalComment.trim().length < 10}>
                        {busy === "final" ? <Loader2 className="spin" size={16} /> : <Send size={16} />}签署并归档
                      </button>
                    </>
                  ) : (
                    <EmptyState icon={<ShieldCheck size={34} />} description="专家审核完成后，由终审人员汇总意见并签署决定。" />
                  )}
                </article>
              </div>}
            </div>
          ),
        }}
      />
    </div>
  );
}
