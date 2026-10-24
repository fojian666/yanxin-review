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
import { EmptyState } from "../components/EmptyState";
import { StatusPill } from "../components/StatusPill";
import { EASE, SPRING, staggerContainer, staggerItem } from "../motion";
import type { CheckStatus, ReviewReport } from "../types";

const STEPS = ["解析文档结构", "检查形式完整性", "核对诚信与规范", "语义查重比对", "生成预审报告"];

const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: "通过",
  warn: "关注",
  fail: "风险",
};

export function ReviewPage() {
  const { docs, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const [docId, setDocId] = useState("");
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState("");
  const runningRef = useRef(false);
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
    if (fromQuery && sortedDocs.some((d) => d.id === fromQuery)) {
      setDocId(fromQuery);
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
    const timer = window.setInterval(() => {
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    }, 650);
    return () => window.clearInterval(timer);
  }, [busy]);

  const run = async () => {
    if (!docId) {
      toast("请先选择一份文档", "error");
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;
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
      "",
      "## 总体判断",
      report.overall.summary,
      "",
    ];
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
        <div className="eyebrow">AI PRE-REVIEW</div>
        <h2>本子预审</h2>
        <p className="hint">
          选定一份申报书，形式、诚信、查重、政策四关依次勘验。AI 只呈检查项与证据——不打分、不排名、不替专家下结论。
        </p>
        <label className="field-label" htmlFor="reviewDoc">待审文档</label>
        <select
          id="reviewDoc"
          className="select"
          value={docId}
          onChange={(event) => {
            setDocId(event.target.value);
            setReport(null);
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
        <button className="btn btn-primary btn-block" onClick={() => void run()} disabled={busy || !docId}>
          {busy ? <><Loader2 size={16} className="spin" />预审中…</> : <><ShieldCheck size={16} />开始 AI 预审</>}
        </button>
        <div className="review-steps">
          <div className="steps-track">
            <motion.div
              className="steps-fill"
              animate={{ height: `${progress}%` }}
              transition={{ duration: 0.52, ease: EASE }}
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
          <p>不输出立项结论、评分与排名；查重相似度不等于抄袭，须人工复核；政策合规需先上传政策库。</p>
        </div>
      </div>

      <div className="panel review-report">
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
                title={error ? "预审失败" : "预审报告将在此呈卷"}
                description={error || "先上传本子，再于左侧选定文档，即可开始预审。"}
              />
            </motion.div>
          ) : (
            <motion.div
              key={report.overall.generated_at}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.31, ease: EASE }}
            >
            <ReportHeader report={report} onExport={exportReport} />
            <ReportSummary report={report} />
            {report.warning && <div className="llm-warning">{report.warning}</div>}
            {report.sections.map((section, sectionIndex) => (
              <motion.div
                className="section-block"
                key={section.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.31, ease: EASE, delay: Math.min(sectionIndex * 0.045, 0.2) }}
              >
                <div className="section-head">
                  <h3>{section.title}</h3>
                  <StatusPill status={section.status} />
                </div>
                {section.items.map((item, index) => (
                  <div className="check-item" key={`${section.key}-${index}`}>
                    <div className="check-top">
                      <div>
                        <div className="check-label">{item.label}</div>
                        <div className="check-detail">{item.detail}</div>
                      </div>
                      <StatusPill status={item.status} />
                    </div>
                    {item.evidence && <div className="check-evidence">{item.evidence}</div>}
                  </div>
                ))}
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
  const risk = report.overall.risk_level;
  const riskClass = risk === "高" ? "risk-high" : risk === "低" ? "risk-low" : "risk-mid";
  return (
    <div className="report-head">
      <div>
        <div className="eyebrow">AI PRE-REVIEW REPORT</div>
        <h2>预审报告</h2>
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
            <span>{report.mode === "qwen" ? "千问预审" : "规则预审"}</span>
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
      <div className="report-meta">
        <span>文本 {report.doc.char_count} 字</span>
        <span>{report.doc.chunk_count} 个文本块</span>
        <span>检查 {report.overall.checked_items} 项</span>
      </div>
    </div>
  );
}
