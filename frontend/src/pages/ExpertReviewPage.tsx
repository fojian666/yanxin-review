import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../AppContext";
import { EmptyState } from "../components/EmptyState";
import { ArtifactEvidence } from "../components/ArtifactEvidence";
import { Markdown } from "../components/Markdown";
import type { ExpertRecommendation, ReviewTask, ToolCheckResult } from "../types";

const RECOMMENDATIONS: { value: ExpertRecommendation; label: string }[] = [
  { value: "approve", label: "建议通过" },
  { value: "revise", label: "建议修改" },
  { value: "reject", label: "建议不通过" },
];

export function ExpertReviewPage() {
  const { auth, toast } = useApp();
  const adminDebug = auth?.role === "admin";
  const [params, setParams] = useSearchParams();
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [selectedId, setSelectedId] = useState(params.get("task") || "");
  const [task, setTask] = useState<ReviewTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [conflictReason, setConflictReason] = useState("");
  const [recommendation, setRecommendation] = useState<ExpertRecommendation>("approve");
  const [opinion, setOpinion] = useState("");

  const pendingCount = useMemo(() => tasks.filter((item) => item.status === "assigned").length, [tasks]);
  const duplicate = (task?.tool_check?.payload as unknown as ToolCheckResult | undefined)?.duplicate;

  const loadTasks = async (preferred = "") => {
    const result = await api.reviewTasks();
    setTasks(result.tasks);
    const next = preferred || selectedId || result.tasks[0]?.id || "";
    setSelectedId(next);
    return next;
  };

  useEffect(() => {
    let active = true;
    void api.reviewTasks()
      .then((result) => {
        if (!active) return;
        setTasks(result.tasks);
        const requested = params.get("task");
        setSelectedId(result.tasks.find((item) => item.id === requested)?.id || result.tasks[0]?.id || "");
      })
      .catch((error) => toast(`审核任务加载失败：${(error as Error).message}`, "error"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setTask(null);
      return;
    }
    let active = true;
    setLoading(true);
    void api.reviewTask(selectedId)
      .then((result) => {
        if (!active) return;
        setTask(result.task);
        setConflict(result.task.conflict_declared);
        setConflictReason(result.task.conflict_reason || "");
        setRecommendation(result.task.recommendation || "approve");
        setOpinion(result.task.opinion || "");
        const next = new URLSearchParams(params);
        next.set("task", result.task.id);
        setParams(next, { replace: true });
      })
      .catch((error) => toast(`任务读取失败：${(error as Error).message}`, "error"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // selectedId is the sole reload key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const submit = async () => {
    if (!task) return;
    setBusy(true);
    try {
      await api.submitReviewTask(task.id, {
        recommendation,
        opinion,
        conflict_declared: conflict,
        conflict_reason: conflictReason,
      });
      await loadTasks(task.id);
      const refreshed = await api.reviewTask(task.id);
      setTask(refreshed.task);
      toast(conflict ? "回避声明已提交并留痕" : "审核意见已提交并留痕");
    } catch (error) {
      toast(`提交失败：${(error as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !task) {
    return <div className="panel expert-review-loading"><Loader2 className="spin" size={20} />正在读取审核任务…</div>;
  }

  if (!tasks.length) {
    return (
      <div className="expert-review-page">
        <section className="panel expert-review-empty">
          <EmptyState icon={<ClipboardCheck size={40} />} description={adminDebug ? "当前没有可调试的审核任务。" : "当前没有分配给您的审核任务。"} />
        </section>
      </div>
    );
  }

  return (
    <div className="expert-review-page">
      <section className="expert-task-strip" aria-label="我的审核任务">
        <div className="expert-task-summary">
          <span>{adminDebug ? "审核任务 · 管理员调试" : "我的审核任务"}</span>
          <strong>{pendingCount} 项待办</strong>
        </div>
        <div className="expert-task-tabs scroll-area">
          {tasks.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === selectedId ? "is-active" : ""}
              aria-pressed={item.id === selectedId}
              disabled={busy}
              onClick={() => { if (item.id !== selectedId) { setTask(null); setLoading(true); setSelectedId(item.id); } }}
            >
              <span className={`status-pill ${item.status === "submitted" ? "status-pass" : item.status === "conflict" ? "status-warn" : "status-idle"}`}>
                {item.status_label}
              </span>
              <strong>{item.case_title}</strong>
              <small>{item.expert_name}</small>
            </button>
          ))}
        </div>
      </section>

      {task && (
        <div className="expert-review-layout">
          <section className="panel expert-review-evidence">
            <div className="panel-head">
              <div>
                <h2>{task.case_title}</h2>
                <p>{task.doc_name}</p>
              </div>
              <Link className="btn btn-ghost btn-sm" to={`/library?doc=${encodeURIComponent(task.doc_id || "")}`}>查看申报书原文</Link>
            </div>
            <div className="expert-review-evidence-body scroll-area">
              <div className="expert-review-meta">
                <span><ShieldCheck size={15} />独立审核</span>
                <span>审核账号：{task.assignee_username}</span>
                <span>候选人：{task.expert_name} · {task.expert_institution}</span>
              </div>
              {task.pre_review?.content ? (
                <>
                  <Markdown content={task.pre_review.content} className="expert-review-markdown" />
                  <ArtifactEvidence artifact={task.pre_review} />
                </>
              ) : (
                <EmptyState icon={<AlertTriangle size={32} />} description="该案卷尚未生成预审报告，请联系管理人员。" />
              )}
              {duplicate && (
                <section className="expert-review-markdown">
                  <h3>文本查重</h3>
                  <p>{duplicate.summary}</p>
                  {duplicate.matches?.map((match, index) => (
                    <div key={`${match.matched_doc_id}-${index}`}>
                      <Link to={`/library?doc=${encodeURIComponent(match.matched_doc_id)}`}>{match.matched_doc_name}</Link>
                      <p>本文：{match.source_snippet}</p><p>比对：{match.matched_snippet}</p>
                    </div>
                  ))}
                </section>
              )}
            </div>
          </section>

          <section className="panel expert-review-form">
            <div className="panel-head">
              <div><h2>审核意见</h2></div>
              <span className={`status-pill ${task.status === "submitted" ? "status-pass" : task.status === "conflict" ? "status-warn" : "status-idle"}`}>{task.status_label}</span>
            </div>
            {task.status === "assigned" ? (
              <div className="expert-review-form-body scroll-area">
                <label className="expert-conflict-toggle">
                  <input type="checkbox" checked={conflict} onChange={(event) => setConflict(event.target.checked)} />
                  <span><strong>声明存在回避情形</strong><small>如存在利益冲突、同单位或本人参与项目，请先声明回避。</small></span>
                </label>
                {conflict ? (
                  <label className="field">
                    <span>回避原因</span>
                    <textarea value={conflictReason} onChange={(event) => setConflictReason(event.target.value)} placeholder="说明与项目、申报单位或负责人的关系" />
                  </label>
                ) : (
                  <>
                    <fieldset className="review-decision-options expert-recommendations">
                      <legend>审核建议</legend>
                      {RECOMMENDATIONS.map((item) => (
                        <label key={item.value} className={recommendation === item.value ? "is-selected" : ""}>
                          <input type="radio" name="recommendation" checked={recommendation === item.value} onChange={() => setRecommendation(item.value)} />
                          {item.label}
                        </label>
                      ))}
                    </fieldset>
                    <label className="field">
                      <span>独立审核意见</span>
                      <textarea value={opinion} onChange={(event) => setOpinion(event.target.value)} placeholder="说明判断依据、需核实问题及修改建议（至少 10 字）" />
                    </label>
                  </>
                )}
                <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
                  {busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                  {conflict ? "提交回避声明" : "提交审核意见"}
                </button>
              </div>
            ) : (
              <div className="expert-review-submitted">
                <CheckCircle2 size={38} />
                <h3>{task.status === "conflict" ? "已提交回避声明" : "审核意见已提交"}</h3>
                <p>{task.status === "conflict" ? task.conflict_reason : task.opinion}</p>
                <small>提交时间：{task.submitted_at?.replace("T", " ")}</small>
                {task.admin_debug && <small className="review-admin-debug">管理员 {task.submitted_by} 调试代提交</small>}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
