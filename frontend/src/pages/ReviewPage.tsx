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
import { EASE, SPRING, useMotionPreference, staggerContainer, staggerItem } from "../motion";
import type { CheckStatus, ReviewReport } from "../types";

const STEPS = ["解析文档结构", "检查形式完整性", "核对诚信与规范", "文本查重比对", "生成预审报告"];

const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: "通过",
  warn: "关注",
  fail: "风险",
};

export function ReviewPage() {
  const { docs, toast, activeDocId, setActiveDocId } = useApp();
  const reduce = useMotionPreference();
  const [params, setParams] = useSearchParams();
  const [docId, setDocId] = useState(activeDocId);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState("");
  const [reportReady, setReportReady] = useState(false);
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
  const reportRef = useRef<HTMLDivElement>(null);
  const runFocusRef = useRef<Element | null>(null);
  const userScrolledRef = useRef(false);
  const progress = report ? 100 : busy ? Math.min(96, ((step + 1) / STEPS.length) * 100) : 0;

  const sortedDocs = useMemo(() => {
    const rank: Record<string, number> = { proposal: 0, other: 1, policy: 2, paper: 3 };
    return [...docs].sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9));
  }, [docs]);

  const selectedDoc = sortedDocs.find((doc) => doc.id === docId);

  useEffect(() => {
    if (!sortedDocs.length) {
      setDocId("");
      return;
    }
    const fromQuery = params.get("doc");
    if (fromQuery && sortedDocs.some((d) => d.id === fromQuery)) {
      setDocId(fromQuery);
      if (sortedDocs.some((d) => d.id === fromQuery && (d.kind === "proposal" || d.kind === "other"))) setActiveDocId(fromQuery);
      // 消费后移除参数，避免用户改选文档时又被 URL 拉回
      const next = new URLSearchParams(params);
      next.delete("doc");
      setParams(next, { replace: true });
      return;
    }
    if (!docId || !sortedDocs.some((d) => d.id === docId)) {
      setDocId(sortedDocs[0].id);
    }
  }, [sortedDocs, params, docId, setParams]);

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
    const target = reportRef.current;
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    target?.focus({ preventScroll: true });
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

  const run = async () => {
    if (!docId) {
      toast("请先选择一份文档", "error");
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;
    runFocusRef.current = document.activeElement;
    userScrolledRef.current = false;
    setReportReady(false);
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const result = await api.review(docId);
      setReport(result);
      setStep(STEPS.length - 1);
    } catch (err) {
      setError((err as Error).message);
      toast(`预审失败：${(err as Error).message}`, "error");
    } finally {
      runningRef.current = false;
      setBusy(false);
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

  return (
    <div className="review-layout">
      <div className="panel review-control">
        <h2>本子预审</h2>
        <label className="field-label" htmlFor="reviewDoc">待审文档</label>
        <select
          id="reviewDoc"
          className="select"
          value={docId}
          onChange={(event) => {
            setDocId(event.target.value);
            if (sortedDocs.some((d) => d.id === event.target.value && (d.kind === "proposal" || d.kind === "other"))) setActiveDocId(event.target.value);
            setReport(null);
            setReportReady(false);
            setError("");
          }}
          disabled={busy}
        >
          {sortedDocs.length === 0 ? (
            <option value="">暂无文档，请先上传</option>
          ) : (
            sortedDocs.map((doc) => (
              <option value={doc.id} key={doc.id}>{doc.name}</option>
            ))
          )}
        </select>
        <div className="picked-doc">
          <span className="picked-doc-label">当前选定</span>
          <span>{selectedDoc?.name || "尚未选定文档"}</span>
        </div>
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
              className={`step ${busy && step === index ? "active" : ""} ${
                report || (!busy && step > index) ? "done" : ""
              }`}
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

      <div className="panel review-report" role="region" aria-label="预审报告" tabIndex={0} ref={reportRef}>
        <AnimatePresence mode="wait" initial={false}>
          {!report ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.34, ease: EASE }}
            >
              <EmptyState
                tall
                icon={<FileSearch size={42} />}
                title={error ? "预审失败" : "预审报告将在这里显示"}
                description={
                  error ||
                  (!sortedDocs.length
                    ? "请先上传申报书。"
                    : docId
                      ? "已选择文档，点击「开始预审」。"
                      : "请先选择待审文档。")
                }
              />
            </motion.div>
          ) : (
            <motion.div
              key={report.overall.generated_at}
              className="report-unveiling"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
            >
            <ReportHeader report={report} onExport={exportReport} />
            <ReportSummary report={report} />
            {report.warning && <div className="llm-warning">{report.warning}</div>}
            {report.sections.map((section, sectionIndex) => (
              <motion.div
                className="section-block"
                key={section.key}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.24, ease: EASE, delay: reduce ? 0 : Math.min(sectionIndex * 0.04, 0.16) }}
              >
                <div className="section-head">
                  <h3>{section.title}</h3>
                  <StatusPill status={section.status} />
                </div>
                {section.items.map((item, index) => {
                  const key = `${section.key}-${index}`;
                  const expanded = expandedEvidence.has(key);
                  const full = item.evidence_full || "";
                  const hasMore = full.length > item.evidence.length;
                  return (
                    <div className="check-item" key={key}>
                      <div className="check-top">
                        <div>
                          <div className="check-label">{item.label}</div>
                          <div className="check-detail">{item.detail}</div>
                        </div>
                        <StatusPill status={item.status} />
                      </div>
                      {item.evidence && (
                        <div className="check-evidence">{expanded ? full : item.evidence}</div>
                      )}
                      {hasMore && (
                        <button
                          type="button"
                          className="source-toggle"
                          aria-expanded={expanded}
                          onClick={() => toggleEvidence(key)}
                        >
                          {expanded ? "收起原文" : `展开全文（${full.length} 字）`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </motion.div>
            ))}
            {report.duplicate.matches.length > 0 && (
              <div className="section-block">
                <div className="section-head">
                  <h3>查重命中详情</h3>
                  <span className="muted">相似度不等于抄袭，需人工判断</span>
                </div>
                {report.duplicate.matches.map((match, index) => (
                  <div className="check-item" key={`${match.matched_doc_name}-${index}`}>
                    <div className="check-label">
                      {match.matched_doc_name} · 相似度 {match.similarity.toFixed(2)}
                    </div>
                    <div className="check-evidence">
                      本子：{match.source_snippet}
                      <br />
                      比对：{match.matched_snippet}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="section-block">
              <div className="section-head">
                <h3>建议向申报人/评审专家核实的问题</h3>
                <span className="muted">{report.questions.length} 条</span>
              </div>
              <motion.div
                className="check-item"
                variants={staggerContainer}
                initial="initial"
                animate="animate"
              >
                <ol className="questions">
                  {report.questions.map((question) => (
                    <motion.li key={question} variants={staggerItem}>{question}</motion.li>
                  ))}
                </ol>
              </motion.div>
            </div>
            <div className="report-actions">
              <motion.button className="btn btn-ghost" onClick={exportReport} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
                <Download size={16} />导出 Markdown
              </motion.button>
              <motion.button className="btn btn-primary" onClick={() => window.print()} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
                <Printer size={16} />打印 / 存为 PDF
              </motion.button>
            </div>
            <div className="disclaimer">{report.disclaimer}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
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
