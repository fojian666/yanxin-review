import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  FileSearch,
  Loader2,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../AppContext";
import { generationLabel } from "../generation";
import { EmptyState } from "../components/EmptyState";
import { StatusPill } from "../components/StatusPill";
import { InlinePager, WorkDeck, type WorkDeckStep } from "../components/WorkDeck";
import { EASE, SPRING, useMotionPreference } from "../motion";
import type { CheckStatus, ReviewReport } from "../types";

const STEPS = ["解析文档结构", "检查形式完整性", "核对诚信与规范", "文本查重比对", "生成预审报告"];

const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: "通过",
  warn: "关注",
  fail: "风险",
};

type ReviewSection = "run" | "summary" | "checks" | "findings" | "boundaries";

const REVIEW_STEPS: WorkDeckStep<ReviewSection>[] = [
  { id: "run", label: "运行预审", hint: "选择本子并执行检查" },
  { id: "summary", label: "结论概览", hint: "风险分类与生成来源" },
  { id: "checks", label: "检查项", hint: "逐项查看依据" },
  { id: "findings", label: "查重与追问", hint: "命中片段与人工问题" },
  { id: "boundaries", label: "边界与导出", hint: "能力范围与报告输出" },
];

export function ReviewPage() {
  const { docs, toast, activeDocId, setActiveDocId, setActiveDossierId } = useApp();
  const reduce = useMotionPreference();
  const [params, setParams] = useSearchParams();
  const [docId, setDocId] = useState(activeDocId);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState("");
  const [reportReady, setReportReady] = useState(false);
  const [section, setSection] = useState<ReviewSection>("run");
  const [checkPage, setCheckPage] = useState(0);
  const [findingPage, setFindingPage] = useState(0);
  const [boundaryPage, setBoundaryPage] = useState(0);
  // 政策条款全文展开态，键为「分区-序号」，换一份报告时清空
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(() => new Set());
  useEffect(() => setExpandedEvidence(new Set()), [report]);
  const toggleEvidence = (key: string) =>
    setExpandedEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const runningRef = useRef(false);
  const requestSequence = useRef(0);
  const reportRef = useRef<HTMLDivElement>(null);
  const runFocusRef = useRef<Element | null>(null);
  const userScrolledRef = useRef(false);
  const progress = report ? 100 : busy ? Math.min(96, ((step + 1) / STEPS.length) * 100) : 0;

  const sortedDocs = useMemo(() => {
    const rank: Record<string, number> = { proposal: 0, other: 1, policy: 2, paper: 3 };
    return [...docs].sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9));
  }, [docs]);

  useEffect(() => {
    if (!sortedDocs.length) {
      setDocId("");
      return;
    }
    const fromQuery = params.get("doc");
    if (!fromQuery) return;
    if (fromQuery && sortedDocs.some((d) => d.id === fromQuery && (d.kind === "proposal" || d.kind === "other"))) {
      setDocId(fromQuery);
      setActiveDossierId("");
      setActiveDocId(fromQuery);
      // 消费后移除参数，避免用户改选文档时又被 URL 拉回
      const next = new URLSearchParams(params);
      next.delete("doc");
      setParams(next, { replace: true });
      return;
    }
    const next = new URLSearchParams(params);
    next.delete("doc");
    setParams(next, { replace: true });
  }, [sortedDocs, params, setActiveDocId, setActiveDossierId, setParams]);

  useEffect(() => {
    if (!activeDocId) {
      requestSequence.current += 1;
      runningRef.current = false;
      setBusy(false);
      setDocId("");
      setReport(null);
      setReportReady(false);
      setError("");
      return;
    }
    if (!sortedDocs.some((doc) => doc.id === activeDocId)) return;
    requestSequence.current += 1;
    runningRef.current = false;
    setBusy(false);
    setDocId(activeDocId);
    setReport(null);
    setReportReady(false);
    setError("");
    setSection("run");
    setCheckPage(0);
    setFindingPage(0);
    setBoundaryPage(0);
  }, [activeDocId, sortedDocs]);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const noteInteraction = () => { userScrolledRef.current = true; };
    const noteScrollKey = (event: KeyboardEvent) => {
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) noteInteraction();
    };
    window.addEventListener("touchmove", noteInteraction, { passive: true });
    window.addEventListener("wheel", noteInteraction, { passive: true });
    window.addEventListener("keydown", noteScrollKey);
    const timer = window.setInterval(() => {
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    }, 650);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("touchmove", noteInteraction);
      window.removeEventListener("wheel", noteInteraction);
      window.removeEventListener("keydown", noteScrollKey);
    };
  }, [busy]);

  const focusReport = () => {
    setSection("summary");
    requestAnimationFrame(() => {
      const target = reportRef.current;
      target?.focus({ preventScroll: true });
    });
    setReportReady(false);
  };

  useEffect(() => {
    if (!report || !window.matchMedia("(max-width: 680px)").matches) return;
    const active = document.activeElement;
    const blocked = document.querySelector('[role="dialog"][aria-modal="true"], .app-shell.nav-open');
    if (userScrolledRef.current || blocked || (active && active !== document.body && active !== runFocusRef.current && !reportRef.current?.contains(active))) {
      setReportReady(true);
      return;
    }
    focusReport();
  }, [report]);

  useEffect(() => {
    if (!report || window.matchMedia("(max-width: 680px)").matches) return;
    setSection("summary");
  }, [report]);

  const run = async () => {
    if (!docId) {
      toast("请先选择一份文档", "error");
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;
    runFocusRef.current = document.activeElement;
    userScrolledRef.current = false;
    const requestId = ++requestSequence.current;
    setReportReady(false);
    setBusy(true);
    setError("");
    setReport(null);
    setCheckPage(0);
    setFindingPage(0);
    setBoundaryPage(0);
    try {
      const result = await api.review(docId);
      if (requestId !== requestSequence.current) return;
      setReport(result);
      setStep(STEPS.length - 1);
    } catch (err) {
      if (requestId !== requestSequence.current) return;
      setError((err as Error).message);
      setSection("summary");
      toast(`预审失败：${(err as Error).message}`, "error");
    } finally {
      if (requestId === requestSequence.current) {
        runningRef.current = false;
        setBusy(false);
      }
    }
  };

  const exportReport = () => {
    if (!report) return;
    const lines = [
      `# 预审报告：${report.doc.name}`,
      "",
      `- 风险等级：${report.overall.risk_level}`,
      `- 生成时间：${report.overall.generated_at}`,
      `- 文本规模：${report.doc.char_count} 字 / ${report.doc.chunk_count} 个文本块`,
      `- 执行模式：${report.mode === "qwen" ? "大模型生成，规则引擎校验" : "离线规则与检索（未启用大模型）"}`,
      `- 生成来源：${generationLabel(report.generation, "规则预审")}`,
      "",
      "## 总体判断",
      report.overall.summary,
      "",
    ];
    if (report.warning) lines.push(`> 运行提示：${report.warning}`, "");
    report.sections.forEach((section) => {
      lines.push(`## ${section.title}（${STATUS_LABELS[section.status]}）`);
      section.items.forEach((item) => {
        lines.push(
          `- [${STATUS_LABELS[item.status]}] ${item.label}：${item.detail}` +
            (item.evidence ? `\n  - 依据：${item.evidence}` : "")
        );
      });
      lines.push("");
    });
    if (report.duplicate.matches.length) {
      lines.push("## 查重命中");
      report.duplicate.matches.forEach((match) => {
        lines.push(`- 与《${match.matched_doc_name}》相似度 ${match.similarity.toFixed(2)}`);
        lines.push(`  - 本子：${match.source_snippet}`);
        lines.push(`  - 比对：${match.matched_snippet}`);
      });
      lines.push("");
    }
    lines.push("## 建议核实的问题");
    report.questions.forEach((question, index) => lines.push(`${index + 1}. ${question}`));
    // 网页上能看到的能力边界与运行警告必须跟着文件走，否则离线报告会被当成语义判断
    if (report.limitations?.length) {
      lines.push("", "## 能力边界", ...report.limitations.map((item, index) => `${index + 1}. ${item}`));
    }
    lines.push("", "---", report.disclaimer);
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `预审报告-${report.doc.name.slice(0, 40)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const flattenedChecks = report?.sections.flatMap((reportSection, sectionIndex) =>
    reportSection.items.map((item, itemIndex) => ({
      section: reportSection,
      item,
      key: `${reportSection.key}-${itemIndex}`,
      sectionIndex,
      itemIndex,
    }))
  ) ?? [];
  const visibleCheckIndex = Math.min(checkPage, Math.max(0, flattenedChecks.length - 1));
  const currentCheck = flattenedChecks[visibleCheckIndex];
  const findings = report
    ? [
        ...report.duplicate.matches.map((match, index) => ({ type: "duplicate" as const, match, key: `duplicate-${index}` })),
        ...report.questions.map((question, index) => ({ type: "question" as const, question, key: `question-${index}` })),
      ]
    : [];
  const visibleFindingIndex = Math.min(findingPage, Math.max(0, findings.length - 1));
  const currentFinding = findings[visibleFindingIndex];
  const limitations = report?.limitations ?? [];
  const visibleBoundaryIndex = Math.min(boundaryPage, Math.max(0, limitations.length - 1));

  return (
    <div className="review-workspace review-deck-workspace">
      <WorkDeck
        className="review-deck"
        steps={REVIEW_STEPS}
        active={section}
        onChange={setSection}
        ariaLabel="预审工作台"
        panels={{
          run: (
            <div className="review-run-page">
              <div className="panel review-control">
                <h2>本子预审</h2>
                <p className="review-run-doc">{docId ? `准备检查：${sortedDocs.find((doc) => doc.id === docId)?.name ?? "已选文档"}` : "请先从上方选择申报书。"}</p>
                <button className="btn btn-primary btn-block" onClick={() => void run()} disabled={busy || !docId}>
                  {busy ? <><Loader2 size={16} className="spin" />预审中…</> : <><ShieldCheck size={16} />开始预审</>}
                </button>
                {reportReady && <div className="review-ready" role="status">预审已完成 <button type="button" className="btn btn-ghost btn-sm" onClick={focusReport}>查看报告</button></div>}
                <div className={`review-steps ${busy ? "is-running" : ""}`}>
                  <div className="steps-track">
                    <motion.div
                      className="steps-fill"
                      animate={{ scaleY: progress / 100 }}
                      style={{ originY: 0 }}
                      transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
                    />
                  </div>
                  {STEPS.map((label, index) => (
                    <div
                      key={label}
                      className={`step ${busy && step === index ? "active" : ""} ${report || (!busy && step > index) ? "done" : ""}`}
                    >
                      <span />
                      {label}
                    </div>
                  ))}
                </div>
                <div className="control-note">
                  <strong>边界</strong>
                  <p>不输出立项结论、评分与排名；查重相似度不等于抄袭，须人工复核；政策引用须人工核对。</p>
                </div>
              </div>
            </div>
          ),
          summary: (
            <div className="review-report review-summary-page" role="region" aria-label="预审报告" tabIndex={0} ref={reportRef}>
              {report ? (
                <>
                  <ReportHeader report={report} onExport={exportReport} />
                  <ReportSummary report={report} />
                  {report.warning && <div className="llm-warning">{report.warning}</div>}
                </>
              ) : (
                <EmptyState
                  tall
                  icon={<FileSearch size={42} />}
                  title={error ? "预审失败" : "预审报告将在这里显示"}
                  description={error || (!sortedDocs.length ? "请先上传申报书。" : docId ? "已选择文档，请回到“运行预审”执行检查。" : "请先选择待审文档。")}
                />
              )}
            </div>
          ),
          checks: (
            <div className="review-report review-check-page" role="region" aria-label="检查项" tabIndex={0}>
              {currentCheck ? (
                <div className="section-block">
                  <div className="section-head">
                    <h3>{currentCheck.section.title}</h3>
                    <StatusPill status={currentCheck.section.status} />
                  </div>
                  <div className="check-item">
                    <div className="check-top">
                      <div>
                        <div className="check-label">{currentCheck.item.label}</div>
                        <div className="check-detail">{currentCheck.item.detail}</div>
                      </div>
                      <StatusPill status={currentCheck.item.status} />
                    </div>
                    {currentCheck.item.evidence && (
                      <div className="check-evidence">
                        {expandedEvidence.has(currentCheck.key) ? currentCheck.item.evidence_full || currentCheck.item.evidence : currentCheck.item.evidence}
                      </div>
                    )}
                    {(currentCheck.item.evidence_full || "").length > currentCheck.item.evidence.length && (
                      <button
                        type="button"
                        className="source-toggle"
                        aria-expanded={expandedEvidence.has(currentCheck.key)}
                        onClick={() => toggleEvidence(currentCheck.key)}
                      >
                        {expandedEvidence.has(currentCheck.key) ? "收起原文" : `展开全文（${(currentCheck.item.evidence_full || "").length} 字）`}
                      </button>
                    )}
                  </div>
                  <InlinePager label="检查项" index={visibleCheckIndex} total={flattenedChecks.length} onChange={setCheckPage} />
                </div>
              ) : (
                <EmptyState icon={<FileSearch size={38} />} description="完成预审后，在这里逐项查看检查结果。" />
              )}
            </div>
          ),
          findings: (
            <div className="review-report review-finding-page" role="region" aria-label="查重与追问" tabIndex={0}>
              {currentFinding ? (
                currentFinding.type === "duplicate" ? (
                  <div className="section-block">
                    <div className="section-head">
                      <h3>查重命中</h3>
                      <span className="muted">相似度不等于抄袭，需人工判断</span>
                    </div>
                    <div className="check-label">{currentFinding.match.matched_doc_name} · 相似度 {currentFinding.match.similarity.toFixed(2)}</div>
                    <div className="check-evidence">本子：{currentFinding.match.source_snippet}<br />比对：{currentFinding.match.matched_snippet}</div>
                  </div>
                ) : (
                  <div className="section-block">
                    <div className="section-head"><h3>建议核实的问题</h3><span className="muted">{visibleFindingIndex + 1} / {findings.length}</span></div>
                    <div className="check-item review-question-card">{currentFinding.question}</div>
                  </div>
                )
              ) : (
                <EmptyState icon={<FileSearch size={38} />} description="完成预审后，查重命中与建议追问将在这里逐项查看。" />
              )}
              <InlinePager label="查重与追问" index={visibleFindingIndex} total={findings.length} onChange={setFindingPage} />
            </div>
          ),
          boundaries: (
            <div className="review-report review-boundaries-page" role="region" aria-label="边界与导出" tabIndex={0}>
              {report ? (
                <>
                  <div className="section-block">
                    <div className="section-head"><h3>能力边界</h3></div>
                    {limitations.length ? (
                      <>
                        <ul className="report-limits questions"><li>{limitations[visibleBoundaryIndex]}</li></ul>
                        <InlinePager label="检查边界" index={visibleBoundaryIndex} total={limitations.length} onChange={setBoundaryPage} />
                      </>
                    ) : <p className="muted">本次结果由模型辅助生成，仍须核对原始材料。</p>}
                    <p className="disclaimer">{report.disclaimer}</p>
                  </div>
                  <div className="report-actions">
                    <motion.button className="btn btn-ghost" onClick={exportReport} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
                      <Download size={16} />导出 Markdown
                    </motion.button>
                    <motion.button className="btn btn-primary" onClick={() => window.print()} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
                      <Printer size={16} />打印 / 存为 PDF
                    </motion.button>
                  </div>
                </>
              ) : (
                <EmptyState icon={<FileSearch size={38} />} description="完成预审后，在这里查看能力边界并导出报告。" />
              )}
            </div>
          ),
        }}
      />
      {report && <ReviewPrintReport report={report} />}
    </div>
  );
}

function ReviewPrintReport({ report }: { report: ReviewReport }) {
  return (
    <article className="review-print-only" aria-hidden="true">
      <h1>预审报告：{report.doc.name}</h1>
      <p>
        风险等级：{report.overall.risk_level} · {generationLabel(report.generation, "规则预审")} ·{" "}
        {report.overall.generated_at.replace("T", " ")}
      </p>
      <h2>总体判断</h2>
      <p>{report.overall.summary}</p>
      {report.warning && <p>{report.warning}</p>}
      {report.sections.map((reportSection) => (
        <section key={reportSection.key}>
          <h2>{reportSection.title}（{STATUS_LABELS[reportSection.status]}）</h2>
          {reportSection.items.map((item, index) => (
            <div className="print-check-item" key={`${reportSection.key}-${index}`}>
              <h3>{item.label}（{STATUS_LABELS[item.status]}）</h3>
              <p>{item.detail}</p>
              {(item.evidence_full || item.evidence) && <p>依据：{item.evidence_full || item.evidence}</p>}
            </div>
          ))}
        </section>
      ))}
      {report.duplicate.matches.length > 0 && (
        <section>
          <h2>查重命中</h2>
          {report.duplicate.matches.map((match, index) => (
            <div className="print-check-item" key={`${match.matched_doc_name}-${index}`}>
              <h3>{match.matched_doc_name} · 相似度 {match.similarity.toFixed(2)}</h3>
              <p>本子：{match.source_snippet}</p>
              <p>比对：{match.matched_snippet}</p>
            </div>
          ))}
        </section>
      )}
      <section>
        <h2>建议核实的问题</h2>
        <ol>{report.questions.map((question) => <li key={question}>{question}</li>)}</ol>
      </section>
      {(report.limitations?.length ?? 0) > 0 && (
        <section>
          <h2>能力边界</h2>
          <ol>{report.limitations!.map((item) => <li key={item}>{item}</li>)}</ol>
        </section>
      )}
      <p>{report.disclaimer}</p>
    </article>
  );
}

function ReportHeader({ report, onExport }: { report: ReviewReport; onExport: () => void }) {
  const reduce = useMotionPreference();
  const risk = report.overall.risk_level;
  const riskClass = risk === "高" ? "risk-high" : risk === "低" ? "risk-low" : "risk-mid";
  return (
    <div className="report-head">
      <div>
        <div className="report-title-row">
          <h2>预审报告</h2>
          <motion.span className="report-seal"
            initial={reduce ? false : { opacity: 0, scale: 1.18, rotate: -9, y: -6 }}
            animate={{ opacity: 1, scale: 1, rotate: -3, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.22, ease: EASE }}
          >待人工复核</motion.span>
        </div>
        <p>{report.doc.name}</p>
      </div>
      <div className="report-head-right">
        <motion.div
          initial={{ scale: 0.82, rotate: -6, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ ...SPRING, delay: 0.08 }}
        >
          <RiskRing level={risk} />
        </motion.div>
        <div>
          <span className={`risk-badge ${riskClass}`}>风险等级：{risk}</span>
          <div className="report-meta">
            <span>{report.mode === "qwen" ? "大模型预审" : "规则预审"}</span>
            <span className="generation-source">{generationLabel(report.generation, "规则预审")}</span>
            <span>{report.overall.generated_at.replace("T", " ")}</span>
          </div>
        </div>
      </div>
      <button className="btn btn-ghost btn-sm report-head-export" onClick={onExport}>
        <Download size={14} />
      </button>
    </div>
  );
}

function RiskRing({ level }: { level: string }) {
  const color = level === "高" ? "#b3453f" : level === "低" ? "#0e7c6b" : "#b5853c";
  return (
    <div
      className="risk-ring"
      role="img"
      aria-label={`风险等级：${level}（分类，非评分）`}
      title={`风险等级：${level}（分类，非评分）`}
      style={{ background: color }}
    >
      <div>{level}</div>
    </div>
  );
}

function ReportSummary({ report }: { report: ReviewReport }) {
  return (
    <div className="report-summary">
      {report.overall.summary}
      {(report.limitations?.length ?? 0) > 0 && (
        <ul className="report-limits">
          {report.limitations!.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <div className="report-meta">
        <span>文本 {report.doc.char_count} 字</span>
        <span>{report.doc.chunk_count} 个文本块</span>
        <span>检查 {report.overall.checked_items} 项</span>
      </div>
    </div>
  );
}
