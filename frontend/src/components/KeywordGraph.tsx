import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Network, Search } from "lucide-react";
import { api } from "../api";
import { useApp } from "../AppContext";
import { useMotionPreference } from "../motion";
import type { KeywordGraphData } from "../types";
import { EChart } from "./EChart";

export function KeywordGraph() {
  const { docs } = useApp();
  const reduce = useMotionPreference();
  const [data, setData] = useState<KeywordGraphData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [retry, setRetry] = useState(0);
  // 文档列表变化时重读；服务端按分块内容缓存提词，删除后不会保留旧节点。
  const revision = docs.map((doc) => `${doc.id}:${doc.chunk_count}:${doc.status}`).sort().join("|");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.keywordGraph().then((result) => {
      if (!active) return;
      setData(result);
      setSelected((current) => result.nodes.some((node) => node.id === current) ? current : result.nodes[0]?.id ?? "");
    }).catch((err) => {
      if (active) { setError((err as Error).message); setData(null); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, retry]);
  const activeNode = data?.nodes.find((node) => node.id === selected);
  const visible = data?.nodes.filter((node) => node.name.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const links = (data?.links.filter((link) => link.source === selected || link.target === selected) ?? [])
    .sort((a, b) => b.similarity - a.similarity || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  const option = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const matching = new Set(visible.map((item) => item.id));
    const adjacent = new Set(links.map((item) => item.source === selected ? item.target : item.source));
    const colors = ["#0e7c6b", "#397d9a", "#b5853c", "#56855a", "#6d7083"];
    return {
      backgroundColor: "transparent",
      animationDuration: reduce ? 0 : 400,
      tooltip: { show: false },
      series: [{
        type: "graph", layout: "none", roam: true, draggable: false,
        scaleLimit: { min: 0.45, max: 3 }, labelLayout: { hideOverlap: true },
        data: nodes.map((node, index) => {
          const angle = index * 2.39996;
          const radius = 30 + Math.sqrt(index) * 39;
          const dim = query.trim() && !matching.has(node.id);
          const active = node.id === selected;
          return {
            id: node.id, nodeId: node.id, name: node.name,
            x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.72,
            symbolSize: 9 + Math.min(13, Math.sqrt(node.chunk_count) * 2),
            itemStyle: { color: colors[index % colors.length], opacity: dim ? 0.18 : 1, borderColor: active ? "#fff7db" : "#fffdf8", borderWidth: active ? 3 : 1 },
            label: { show: true, position: "right", color: "#314b43", fontSize: active || adjacent.has(node.id) ? 11 : 10, opacity: dim ? 0.2 : 1 },
          };
        }),
        links: (data?.links ?? []).map((link) => ({
          source: link.source, target: link.target,
          lineStyle: { color: "#397c6c", width: link.source === selected || link.target === selected ? 1.7 : 0.7, opacity: link.source === selected || link.target === selected ? 0.65 : 0.17, curveness: 0.08 },
        })),
        emphasis: { focus: "adjacency" },
      }],
    } as Record<string, unknown>;
  }, [data, links, query, reduce, selected, visible]);

  return <div className="knowledge-graph-page keyword-graph">
    <section className="kg-summary" aria-label="关键词图谱概况">
      <div className="kg-summary-title"><span className="kg-summary-icon" aria-hidden="true"><Network size={22} /></span><div><strong>文档关键词星图</strong><span>从已收录文本提词，连线表示分块上下文相近，需结合原文核对。</span></div></div>
      <div className="kg-stats"><span><strong>{data?.nodes.length ?? "—"}</strong>关键词</span><span><strong>{data?.links.length ?? "—"}</strong>关联</span><span><strong>{data?.document_count ?? "—"}</strong>来源文档</span></div>
    </section>
    {error ? <div className="panel keyword-graph-message" role="alert">图谱读取失败：{error} <button type="button" className="link-btn" onClick={() => setRetry((n) => n + 1)}>重试</button></div> : loading && !data ? <div className="panel keyword-graph-message" role="status">正在整理文档关键词…</div> : !data?.nodes.length ? <div className="panel keyword-graph-message">暂无可提取的关键词，请先上传可读取文本的文档。</div> :
    <div className="kg-workbench">
      <aside className="panel keyword-list-panel">
        <div className="kg-panel-head"><span><Search size={16} />关键词</span><span>{visible.length} / {data.nodes.length}</span></div>
        <label className="keyword-search"><span className="sr-only">搜索关键词</span><input className="select" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词" /></label>
        <div className="keyword-list">{visible.map((node) => <button key={node.id} type="button" className={node.id === selected ? "is-active" : ""} aria-pressed={node.id === selected} onClick={() => setSelected(node.id)}><span>{node.name}</span><small>{node.chunk_count} 段</small></button>)}{!visible.length && <p>未找到匹配关键词</p>}</div>
      </aside>
      <section className="kg-canvas-panel" aria-label="文档关键词星图"><div className="kg-canvas-head"><div><Network size={17} /><strong>关键词关联</strong></div><span className="keyword-method">{data.method}</span></div><div className="kg-canvas"><EChart option={option} height="100%" className="kg-chart" ariaLabel={`文档关键词星图，${data.nodes.length} 个关键词，${data.links.length} 条关联。可使用关键词列表查看来源。`} onClick={(raw) => { const id = (raw as { data?: { nodeId?: string } }).data?.nodeId; if (id) setSelected(id); }} /><p className="kg-canvas-hint">点击关键词查看来源 · 拖动平移 · 滚轮缩放</p></div></section>
      <aside className="panel keyword-detail"><div className="kg-panel-head"><span><BookOpen size={17} />关键词详情</span></div>{activeNode && <div className="keyword-detail-body"><h2>{activeNode.name}</h2><p>出现在 {activeNode.chunk_count} 个文本分块中</p><h3>相近关键词 · 共现相似度</h3><div className="keyword-neighbors">{links.length ? links.slice(0, 12).map((link) => { const other = link.source === selected ? link.target : link.source; return <button type="button" key={other} onClick={() => setSelected(other)}>{other}<small>{Math.round(link.similarity * 100)}%</small></button>; }) : <p>暂无足够的共现关联</p>}</div><h3>原文来源</h3>{activeNode.sources.map((source) => <div className="keyword-source" key={`${source.doc_id}:${source.chunk_idx}`}><Link to={`/library?doc=${encodeURIComponent(source.doc_id)}`}>{source.doc_name}</Link><small>{source.section || "正文"}{source.page ? ` · 第 ${source.page} 页` : ""}</small><p>{source.excerpt}</p></div>)}<p className="keyword-caveat">关联仅表示词语在相似文本分块中出现，不代表因果、引用或人工认定的关系。</p></div>}</aside>
    </div>}
  </div>;
}
