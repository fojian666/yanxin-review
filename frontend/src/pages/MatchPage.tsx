import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSearch,
  Loader2,
  ScanSearch,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../AppContext";
import { EmptyState } from "../components/EmptyState";
import { KpiCard } from "../components/KpiCard";
import { EASE, staggerContainer, staggerItem } from "../motion";
import type { Expert, ExpertCandidate, ToolCheckResult } from "../types";

const EXPERT_TEMPLATE =
  "姓名,单位,职称,学科,研究方向,代表性成果,回避单位,回避人员,在研项目数,是否可评审\n" +
  "示例专家A,示例大学A,教授,科研管理,科研诚信;科技政策,主持科研诚信相关课题（示例）,示例大学B,,1,是\n" +
  "示例专家B,示例大学B,教授,计算机科学,语义查重;文本挖掘,发表语义查重论文（示例）,,,2,是\n";

function scoreClass(score: number) {
  if (score >= 0.55) return "status-fail";
  if (score >= 0.3) return "status-warn";
  return "status-pass";
}

function expertStatus(expert: Expert) {
  if (!expert.available) return { label: "不可评审", cls: "status-fail" };
  if (expert.workload >= 5) return { label: "负载已满", cls: "status-warn" };
  return { label: "可评审", cls: "status-pass" };
}

export function MatchPage() {
  const { docs, toast, can } = useApp();
  const [docId, setDocId] = useState("");
  const [result, setResult] = useState<ToolCheckResult | null>(null);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadingRef = useRef(false);
  const csvRef = useRef<HTMLInputElement>(null);

  const sortedDocs = useMemo(() => {
    const rank: Record<string, number> = { proposal: 0, other: 1, policy: 2, paper: 3 };
    return [...docs].sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9));
  }, [docs]);

  const loadExperts = async () => {
    try {
      const data = await api.experts();
      setExperts(data.experts);
    } catch (err) {
      toast(`专家库加载失败：${(err as Error).message}`, "error");
    }
  };

  useEffect(() => {
    void loadExperts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sortedDocs.length) {
      setDocId("");
      return;
    }
    if (!docId || !sortedDocs.some((doc) => doc.id === docId)) {
      setDocId(sortedDocs[0].id);
    }
  }, [sortedDocs, docId]);

  const run = async () => {
    if (!docId) {
      toast("请先选择待查本子", "error");
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const data = await api.toolCheck(docId);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
      toast(`一体化检查失败：${(err as Error).message}`, "error");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const importExperts = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = await api.importExperts(file);
      await loadExperts();
      toast(`已导入 ${data.count || 0} 位专家`);
      if (docId) await run();
    } catch (err) {
      toast(`专家导入失败：${(err as Error).message}`, "error");
    }
  };

  const removeSamples = async () => {
    if (!confirm("确定移除所有演示专家？导入的真实专家不受影响。")) return;
    try {
      const data = await api.removeSampleExperts();
      await loadExperts();
      toast(`已移除 ${data.removed || 0} 位演示专家`);
      if (docId) await run();
    } catch (err) {
      toast(`移除失败：${(err as Error).message}`, "error");
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob(["\uFEFF" + EXPERT_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "专家导入模板.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportReport = () => {
    if (!result) return;
    const lines = [
      `# 智能查重与专家匹配报告`,
      "",
      `- 待查文档：${result.doc.name}`,
      `- 生成时间：${result.generated_at.replace("T", " ")}`,
      "",
      "## 语义查重",
      result.duplicate.summary,
      "",
    ];
    if (result.duplicate.matches.length) {
      result.duplicate.matches.forEach((match) => {
        lines.push(`- 与《${match.matched_doc_name}》相似度 ${match.similarity.toFixed(2)}`);
        lines.push(`  - 本子：${match.source_snippet}`);
        lines.push(`  - 比对：${match.matched_snippet}`);
      });
    } else {
      lines.push("当前已入库文档范围内未发现相似文档。");
    }
    lines.push("", "## 专家匹配", result.match.summary, "");
    lines.push(`- 申报单位：${result.match.applicant.institutions.join("、") || "未识别"}`);
    lines.push(`- 申报人：${result.match.applicant.people.join("、") || "未识别"}`);
    lines.push(`- 主题词：${result.match.proposal_keywords.join("、")}`);
    lines.push("");
    result.match.candidates.forEach((candidate, index) => {
      lines.push(
        `${index + 1}. ${candidate.expert.name}（${candidate.expert.institution} / ${candidate.expert.title}）` +
          ` 匹配分 ${(candidate.score * 100).toFixed(1)}（相对 ${((candidate.relative_score ?? candidate.score) * 100).toFixed(0)}）`
      );
      candidate.reasons.forEach((reason) => lines.push(`   - ${reason}`));
    });
    if (result.match.excluded.length) {
      lines.push("", "### 已排除");
      result.match.excluded.forEach((item) => {
        lines.push(`- ${item.name}（${item.institution}）：${item.reason}`);
      });
    }
    lines.push("", "---", result.disclaimer);
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `查重匹配报告-${result.doc.name.slice(0, 40)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const duplicate = result?.duplicate;
  const match = result?.match;

  return (
    <div className="match-page">
      <div className="panel match-hero">
        <div className="match-hero-copy">
          <div className="eyebrow">INTEGRATED TOOL · DUPLICATE + EXPERT MATCHING</div>
          <h2>智能查重 · 专家匹配</h2>
          <p>
            一份本子，一次运行：段落级语义查重与专家画像匹配同步完成，回避与负载约束前置过滤，每一条推荐都有证据与理由，可解释、可复核——对应课题考核指标的一体化工具。
          </p>
        </div>
        <div className="match-controls">
          <label className="field-label" htmlFor="matchDoc">待查本子</label>
          <select
            id="matchDoc"
            className="select"
            value={docId}
            onChange={(event) => {
              setDocId(event.target.value);
              setResult(null);
              setError("");
            }}
          >
            {sortedDocs.length === 0 ? (
              <option value="">暂无文档，请先上传</option>
            ) : (
              sortedDocs.map((doc) => <option value={doc.id} key={doc.id}>{doc.name}</option>)
            )}
          </select>
          <div className="match-actions">
            <button className="btn btn-primary" onClick={() => void run()} disabled={loading || !docId}>
              {loading ? <><Loader2 size={16} className="spin" />检查中…</> : <><ScanSearch size={16} />运行一体化检查</>}
            </button>
            <button className="btn btn-ghost" onClick={exportReport} disabled={!result}>
              <Download size={16} />导出结果
            </button>
          </div>
          <div className="match-summary-line">
            {match ? match.summary : "选择一份本子，开始查重与专家匹配。"}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            className="panel error-panel"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            <AlertTriangle size={18} />{error}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="kpi-grid">
        <KpiCard
          label="最高相似度"
          value={duplicate ? `${Math.round(duplicate.highest * 100)}%` : "—"}
          sub={duplicate ? `高相似 ${duplicate.high_count} · 关注 ${duplicate.watch_count}` : "尚未检查"}
          tone="teal"
        />
        <KpiCard
          label="查重命中"
          value={duplicate ? duplicate.matches.length : 0}
          suffix="个"
          sub="仅统计已入库文档"
        />
        <KpiCard
          label="候选专家"
          value={match ? match.candidates.length : 0}
          suffix="位"
          sub={match ? `满足约束 ${match.available_count} / ${match.total_experts}` : "尚未匹配"}
          tone="gold"
        />
        <KpiCard
          label="已排除专家"
          value={match ? match.excluded.length : 0}
          suffix="位"
          sub="负载 / 回避 / 不可评审"
        />
      </div>

      <div className="match-grid">
        <div className="panel match-panel">
          <div className="panel-head">
            <div>
              <h2>语义查重</h2>
              <p>段落级相似度 + 原文证据；相似不等于抄袭，需人工复核</p>
            </div>
            <span className={`status-pill ${duplicate && duplicate.high_count ? "status-fail" : duplicate && duplicate.watch_count ? "status-warn" : "status-pass"}`}>
              {duplicate ? (duplicate.high_count ? "高风险" : duplicate.watch_count ? "需关注" : "未发现高相似") : "待检查"}
            </span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {!result ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <EmptyState
                  icon={<FileSearch size={38} />}
                  description="运行检查后，这里会显示与已入库文档的相似段落和证据。"
                />
              </motion.div>
            ) : (
              <motion.div
                key={`duplicate-${result.generated_at}-${result.doc.id}`}
                className="match-body"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease: EASE }}
              >
              <div className="match-callout">{duplicate?.summary}</div>
              {duplicate?.matches.length ? (
                <motion.div variants={staggerContainer} initial="initial" animate="animate">
                  {duplicate.matches.map((item, index) => (
                    <motion.div className="duplicate-card" key={`${item.matched_doc_id}-${index}`} variants={staggerItem}>
                      <div className="duplicate-head">
                        <div>
                          <div className="duplicate-title">{item.matched_doc_name}</div>
                          <div className="muted">最高段落相似度 {item.similarity.toFixed(2)}</div>
                        </div>
                        <span className={`status-pill ${scoreClass(item.similarity)}`}>
                          {item.similarity >= 0.55 ? "高相似" : item.similarity >= 0.3 ? "关注" : "低相似"}
                        </span>
                      </div>
                      <div className="check-evidence">本子：{item.source_snippet}</div>
                      <div className="check-evidence">比对：{item.matched_snippet}</div>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <EmptyState icon={<CheckCircle2 size={34} />} description="当前已入库文档范围内未发现相似文档；入库范围越大，查重越有效。" />
              )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="panel match-panel">
          <div className="panel-head">
            <div>
              <h2>专家匹配</h2>
              <p>方向相似度 + 关键词 + 回避/负载约束，可解释排序</p>
            </div>
            <span className="count-badge">{match?.candidates.length ?? 0}</span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {!result ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <EmptyState
                  icon={<Users size={38} />}
                  description="运行检查后，这里会显示候选专家、匹配理由和排除原因。"
                />
              </motion.div>
            ) : (
              <motion.div
                key={`experts-${result.generated_at}-${result.doc.id}`}
                className="match-body"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease: EASE }}
              >
              <div className="match-callout">
                <strong>申报单位：</strong>{match?.applicant.institutions.join("、") || "未识别"}
                <br />
                <strong>申报人：</strong>{match?.applicant.people.join("、") || "未识别"}
              </div>
              <div className="keyword-chips">
                {match?.proposal_keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
              </div>
              {match?.candidates.length ? (
                <motion.div variants={staggerContainer} initial="initial" animate="animate">
                  {match.candidates.map((candidate, index) => (
                    <ExpertCard key={candidate.expert.id} candidate={candidate} index={index} />
                  ))}
                </motion.div>
              ) : (
                <EmptyState icon={<UserX size={34} />} description="没有满足约束的候选专家，请检查专家库或回避/负载设置。" />
              )}
              {match?.excluded.length ? (
                <details className="excluded-box">
                  <summary><UserX size={14} />已排除 {match.excluded.length} 位（负载 / 回避 / 不可评审）</summary>
                  <div className="excluded-list">
                    {match.excluded.map((item) => (
                      <div key={`${item.name}-${item.reason}`}>
                        <strong>{item.name}</strong>（{item.institution}）：{item.reason}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>专家库</h2>
            <p>用于专家画像匹配；不包含性别、年龄等敏感属性。演示专家可一键移除。</p>
          </div>
          <div className="head-actions">
            <span className="count-badge">{experts.length}</span>
            <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}>
              <Download size={14} />下载 CSV 模板
            </button>
            {can("import") && (
            <button className="btn btn-ghost btn-sm" onClick={() => csvRef.current?.click()}>
              <Upload size={14} />导入专家 CSV
            </button>
            )}
            <input
              ref={csvRef}
              type="file"
              accept=".csv"
              hidden
              onChange={(event) => {
                void importExperts(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {can("remove-sample") && (
            <button className="btn btn-ghost btn-sm" onClick={() => void removeSamples()}>
              <Trash2 size={14} />移除演示专家
            </button>
            )}
          </div>
        </div>
        <div className="table-wrap scroll-area">
          {experts.length === 0 ? (
            <EmptyState icon={<Users size={38} />} description="专家库为空，请导入专家 CSV。" />
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>姓名</th><th>单位</th><th>学科</th><th>研究方向</th><th>在研</th><th>状态</th></tr>
              </thead>
              <tbody>
                {experts.map((expert, index) => {
                  const status = expertStatus(expert);
                  return (
                    <motion.tr
                      key={expert.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.34, ease: EASE, delay: Math.min(index * 0.015, 0.18) }}
                    >
                      <td>
                        <div className="doc-title">{expert.name}</div>
                        {expert.is_sample ? <span className="badge-sample">演示</span> : null}
                      </td>
                      <td>{expert.institution}</td>
                      <td>{expert.discipline}</td>
                      <td>{expert.research_areas}</td>
                      <td>{expert.workload}</td>
                      <td><span className={`status-pill ${status.cls}`}>{status.label}</span></td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="disclaimer">
        工具输出仅供科研管理与评审辅助，不构成重复申报认定或专家抽取结论；所有结果须人工复核。
      </div>
    </div>
  );
}

function ExpertCard({ candidate, index }: { candidate: ExpertCandidate; index: number }) {
  const pct = Math.round((candidate.relative_score ?? candidate.score) * 100);
  return (
    <motion.div className="expert-card" variants={staggerItem}>
      <div className="expert-rank">{index + 1}</div>
      <div className="expert-main">
        <div className="expert-head">
          <div>
            <div className="expert-name">{candidate.expert.name}</div>
            <div className="expert-meta">
              {candidate.expert.institution} · {candidate.expert.title}
            </div>
          </div>
          <div className="expert-score">
            <strong>{pct}</strong><span>相对匹配</span>
          </div>
        </div>
        <div className="score-meter"><i style={{ width: `${Math.max(4, pct)}%` }} /></div>
        <div className="reason-chips">
          {candidate.reasons.map((reason) => <span key={reason}>{reason}</span>)}
        </div>
      </div>
    </motion.div>
  );
}
