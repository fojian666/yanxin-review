import { AnimatePresence, motion } from "framer-motion";
import {
  Box,
  Info,
  LineChart,
  Pause,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../AppContext";
import { AnnualChart3D, TopicMatrix3D, TrendBar2D, TrendLine2D } from "../charts/TrendCharts";
import { KpiCard } from "../components/KpiCard";
import { Markdown } from "../components/Markdown";
import { hasWebGL } from "../components/EChart";
import { WorkDeck, type WorkDeckStep } from "../components/WorkDeck";
import { EASE, SPRING, useMotionPreference, staggerContainer, staggerItem } from "../motion";
import type { TrendData } from "../types";

const CHIPS = ["科研诚信", "大模型", "语义查重", "知识图谱", "专家评审", "成果转化", "自然资源"];

type TrendSection = "controls" | "charts" | "summary" | "papers";

const TREND_STEPS: WorkDeckStep<TrendSection>[] = [
  { id: "controls", label: "分析设置", hint: "主题、年份与核心指标" },
  { id: "charts", label: "趋势图表", hint: "年度与主题结构" },
  { id: "summary", label: "研判摘要", hint: "统计结论与边界" },
  { id: "papers", label: "代表文献", hint: "逐年主题与论文" },
];

function yearOptions(from: number, to: number) {
  // 边界由调用方决定（用于区间联动：起始 ≤ 结束），此处不再强制扩展
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export function TrendPage() {
  const { papers, refreshPapers, toast, can } = useApp();
  const [query, setQuery] = useState("科研诚信");
  const [start, setStart] = useState(2019);
  const [end, setEnd] = useState(2025);
  const [data, setData] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"3d" | "2d">("3d");
  const webgl = useMemo(() => hasWebGL(), []);
  const reduce = useMotionPreference();
  const [rotationEnabled, setRotationEnabled] = useState(true);
  const [section, setSection] = useState<TrendSection>("controls");
  const initialized = useRef(false);
  const loadingRef = useRef(false);

  const run = async (q: string, s: number, e: number, revealCharts = true) => {
    const topic = q.trim();
    if (!topic) {
      toast("请输入一个分析主题", "error");
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await api.trends(topic, s, e);
      setData(result);
      setQuery(topic);
      if (revealCharts) setSection("charts");
    } catch (err) {
      setError((err as Error).message);
      toast(`趋势分析失败：${(err as Error).message}`, "error");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }
    const timer = window.setTimeout(() => setShowLoading(true), 280);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void run("科研诚信", 2019, 2025, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!papers.length) return;
    const years = papers.map((p) => p.year).filter((y): y is number => Boolean(y));
    if (!years.length) return;
    setStart(Math.min(...years));
    setEnd(Math.max(...years));
  }, [papers]);

  // 区间联动：起始年只能选 ≤ 结束年，结束年只能选 ≥ 起始年，杜绝倒置区间
  const startOptions = yearOptions(Math.min(2005, start), end);
  const endOptions = yearOptions(start, Math.max(2035, end));
  const effectiveView = webgl ? view : "2d";
  const stats = data?.stats;

  const clearSamples = async () => {
    if (!confirm("确定移除所有演示文献？导入的真实文献不受影响。")) return;
    try {
      const result = await api.removeSamplePapers();
      await refreshPapers();
      toast(`已移除 ${result.removed || 0} 篇演示文献`);
      await run(query, start, end);
    } catch (err) {
      toast(`移除失败：${(err as Error).message}`, "error");
    }
  };

  return (
    <div className="trend-page trend-deck-workspace">
      <WorkDeck
        className="trend-deck"
        steps={TREND_STEPS}
        active={section}
        onChange={setSection}
        ariaLabel="文献趋势工作台"
        status={<div className="trend-deck-status"><span className="count-badge">{stats?.total ?? 0} 篇</span>{data?.sample && <small>演示数据</small>}</div>}
        panels={{
          controls: (
            <div className="trend-controls-page">
              <div className="panel trend-hero">
                <div className="trend-hero-copy"><h2>历史沿革 · 多年文献趋势</h2><p>输入主题，查看文献数量和关键词变化。</p></div>
                <div className="trend-controls">
                  <div className="search-box">
                    <Search size={18} />
                    <input aria-label="分析主题" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === "Enter") void run(query, start, end); }} placeholder="任意方面，如：大模型在科研诚信中的应用" />
                  </div>
                  <div className="year-row">
                    <select aria-label="起始年份" value={start} onChange={(event) => setStart(Number(event.target.value))}>{startOptions.map((year) => <option key={year} value={year}>{year}</option>)}</select>
                    <span>—</span>
                    <select aria-label="结束年份" value={end} onChange={(event) => setEnd(Number(event.target.value))}>{endOptions.map((year) => <option key={year} value={year}>{year}</option>)}</select>
                    <motion.button className="btn btn-primary" onClick={() => void run(query, start, end)} disabled={loading} whileTap={loading ? undefined : { scale: 0.97 }} transition={{ duration: 0.34, ease: EASE }}>{showLoading ? "分析中…" : "分析趋势"}</motion.button>
                  </div>
                </div>
              </div>
              <div className="chips">{CHIPS.map((chip) => <motion.button key={chip} className={`chip ${query === chip ? "active" : ""}`} onClick={() => { setQuery(chip); void run(chip, start, end); }} disabled={loading} whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} transition={{ duration: 0.23, ease: EASE }}>{chip}</motion.button>)}</div>
              <AnimatePresence initial={false}>
                {data?.sample && <motion.div className="notice" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.34, ease: EASE }}><div><strong>演示数据</strong> · 当前趋势图使用合成文献验证功能，不代表真实研究结论。</div>{can("remove-sample") && <button className="btn btn-ghost btn-sm danger" onClick={() => void clearSamples()}><Trash2 size={14} />移除演示文献</button>}</motion.div>}
              </AnimatePresence>
              <AnimatePresence>
                {error && <motion.div className="panel error-panel" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.34, ease: EASE }}><Info size={18} />{error}</motion.div>}
              </AnimatePresence>
              <div className="kpi-grid">
                <KpiCard label="相关文献" value={stats?.total ?? 0} suffix="篇" sub={`真实 ${stats?.real_count ?? 0} · 演示 ${stats?.sample_count ?? 0}`} tone="teal" delay={0} />
                <KpiCard label="年份跨度" format="range" value={stats ? `${stats.year_start}—${stats.year_end}` : "—"} sub="按发表年份统计" delay={0.05} />
                <KpiCard label="最热主题" format="text" value={stats?.top_keyword || "—"} sub="出现频次最高的主题词" tone="gold" delay={0.1} />
                <KpiCard label="年度变化" value={stats?.growth_pct == null ? "新增" : `${stats.growth_pct > 0 ? "+" : ""}${stats.growth_pct}%`} sub={`首年 ${stats?.first_year_count ?? 0} 篇 → 末年 ${stats?.last_year_count ?? 0} 篇`} delay={0.15} />
              </div>
            </div>
          ),
          charts: (
            <div className="trend-chart-page">
              <div className="trend-toolbar">
                <div><span className={`live-dot ${showLoading ? "loading" : ""}`} />趋势视图<span className="muted"> · 3D 可拖拽，2D 便于读数</span></div>
                <div className="trend-view-actions">
                  {effectiveView === "3d" && <button className="btn btn-ghost btn-sm rotation-toggle" onClick={() => setRotationEnabled((enabled) => !enabled)} disabled={reduce} aria-pressed={rotationEnabled && !reduce} aria-label="自动旋转" title={reduce ? "已遵循系统减少动态效果设置" : "同时控制两张 3D 图表；离屏与后台自动暂停"}>{rotationEnabled && !reduce ? <Pause size={14} /> : <Play size={14} />}{reduce ? "旋转已关闭" : rotationEnabled ? "暂停旋转" : "继续旋转"}</button>}
                  <div className="view-toggle"><motion.span className="view-pill" animate={{ x: effectiveView === "3d" ? "0%" : "100%" }} transition={SPRING} /><button className={effectiveView === "3d" ? "active" : ""} onClick={() => webgl && setView("3d")} disabled={!webgl} title={webgl ? "3D 视图" : "当前浏览器不支持 WebGL"} aria-pressed={effectiveView === "3d"}><Box size={14} /><span>3D</span></button><button className={effectiveView === "2d" ? "active" : ""} onClick={() => setView("2d")} aria-pressed={effectiveView === "2d"}><LineChart size={14} /><span>2D</span></button></div>
                </div>
              </div>
              {data ? (
                <div className="trend-grid three-d">
                  <div className="panel chart-panel chart-dark"><div className="panel-head"><div><h2>年度发文量</h2><p>{effectiveView === "3d" ? `3D 立体柱 · ${rotationEnabled && !reduce ? "自动旋转" : "已暂停，可拖拽"}` : "相关文献按年排布，起伏即脉络"}</p></div><span className={`mode-badge ${effectiveView === "3d" ? "online" : ""}`}>{effectiveView === "3d" ? "LIVE 3D" : "2D"}</span></div><AnimatePresence mode="wait" initial={false}><motion.div key={effectiveView} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.23, ease: EASE }}>{effectiveView === "3d" ? <AnnualChart3D data={data} autoRotate={rotationEnabled} /> : <TrendBar2D data={data} />}</motion.div></AnimatePresence>{showLoading && <div className="chart-loading"><span className="spinner" />更新中…</div>}</div>
                  <div className="panel chart-panel chart-dark"><div className="panel-head"><div><h2>主题热度矩阵</h2><p>{effectiveView === "3d" ? "主题 × 年份 × 文献数 · 可旋转" : "主题 × 年份 × 篇数，一张矩阵看冷暖"}</p></div><span className={`mode-badge ${effectiveView === "3d" ? "online" : ""}`}>{effectiveView === "3d" ? "3D MATRIX" : "2D"}</span></div><AnimatePresence mode="wait" initial={false}><motion.div key={effectiveView} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.23, ease: EASE }}>{effectiveView === "3d" ? <TopicMatrix3D data={data} autoRotate={rotationEnabled} /> : <TrendLine2D data={data} />}</motion.div></AnimatePresence>{showLoading && <div className="chart-loading"><span className="spinner" />更新中…</div>}</div>
                </div>
              ) : <div className="panel skeleton-panel"><div className="skeleton skeleton-title" /><div className="skeleton-grid"><div className="skeleton" /><div className="skeleton" /></div></div>}
              {!webgl && <div className="webgl-note"><Info size={15} />当前浏览器未启用 WebGL，已自动使用 2D 图表；3D 视图在支持 WebGL 的浏览器中可用。</div>}
            </div>
          ),
          summary: (
            <div className="trend-summary-page">
              {data ? (
                <motion.div className="panel summary-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.34, ease: EASE }}>
                  <div className="panel-head"><div><h2>趋势分析</h2><p>基于当前文献集合统计而成，不替代人工文献综述</p></div><span className={`mode-badge ${data.mode === "qwen" ? "online" : ""}`}>{data.mode === "qwen" ? "大模型生成" : "规则摘要"}</span></div>
                  <motion.div key={`summary-${data.query}-${data.mode}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.31, ease: EASE }}><Markdown content={data.summary || "暂无趋势摘要。"} className="summary-body" />{data.top_keywords_by_year.length > 0 && <motion.div className="year-topic-grid" key={`topics-${data.query}`} variants={staggerContainer} initial="initial" animate="animate">{data.top_keywords_by_year.filter((x) => x.keywords.length > 0).map((item) => <motion.div className="year-topic" key={item.year} variants={staggerItem}><div className="year-topic-year">{item.year}</div><div className="year-topic-chips">{item.keywords.map((kw) => <span key={kw.name}>{kw.name} <em>{kw.count}</em></span>)}</div></motion.div>)}</motion.div>}</motion.div>
                </motion.div>
              ) : <div className="panel skeleton-panel"><div className="skeleton skeleton-title" /><div className="skeleton" /></div>}
            </div>
          ),
          papers: (
            <div className="panel trend-papers-page">
              <div className="panel-head"><div><h2>代表性文献</h2><p>{data?.papers.length ? `展示前 ${data.papers.length} 篇` : "暂无匹配"}</p></div></div>
              {data ? (
                <motion.div className="paper-list" key={`papers-${data.query}-${data.stats.total}`} variants={staggerContainer} initial="initial" animate="animate">
                  {data.papers.length === 0 ? <div className="empty-state" style={{ gridColumn: "1 / -1" }}><p>暂无匹配文献。换一枚主题词，或在文档中心导入真实文献 CSV 再试。</p></div> : data.papers.map((paper, index) => <motion.div className="paper-card" key={`${paper.id}-${index}`} variants={staggerItem} whileHover={{ y: -2 }}><div className="paper-year">{paper.year} {paper.is_sample && <span className="badge-sample">演示</span>}</div><div className="paper-title">{paper.title}</div><div className="paper-meta">{paper.keywords}</div></motion.div>)}
                </motion.div>
              ) : <div className="skeleton" />}
            </div>
          ),
        }}
      />
    </div>
  );
}
