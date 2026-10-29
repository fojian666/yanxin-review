import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Network, Search } from "lucide-react";
import { api } from "../api";
import { useApp } from "../AppContext";
import { useMotionPreference } from "../motion";
import type { KeywordGraphData } from "../types";
import { EChart } from "./EChart";

// 每圈容纳 6、12、18… 个点，按固定顺序向外展开。
function radialPosition(index: number, spacing: number): [number, number] {
  if (index === 0) return [0, 0];
  let ring = 1;
  let remaining = index - 1;
  while (remaining >= ring * 6) { remaining -= ring * 6; ring += 1; }
  const angle = -Math.PI / 2 + (2 * Math.PI * remaining) / (ring * 6) + (ring % 2) * Math.PI / (ring * 6);
  return [Math.cos(angle) * ring * spacing, Math.sin(angle) * ring * spacing];
}

export function KeywordGraph() {
  const { docs, dossiers } = useApp();
  const reduce = useMotionPreference();
  const [data, setData] = useState<KeywordGraphData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [retry, setRetry] = useState(0);
  const [limit, setLimit] = useState(100);
  const [dossierId, setDossierId] = useState("");
  // 文档列表变化时重读；服务端按分块内容缓存提词，删除后不会保留旧节点。
  const revision = docs.map((doc) => `${doc.id}:${doc.chunk_count}:${doc.status}`).sort().join("|");
  const materialsRevision = dossiers.find((dossier) => dossier.id === dossierId)?.materials.map((item) => item.doc_id).sort().join("|") ?? "";
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    api.keywordGraph(limit, dossierId).then((result) => {
      if (!active) return;
      setData(result);
      setSelected((current) => result.nodes.some((node) => node.id === current) ? current : result.nodes[0]?.id ?? "");
    }).catch((err) => {
      if (active) { setError((err as Error).message); setData(null); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, materialsRevision, limit, dossierId, retry]);
  const activeNode = data?.nodes.find((node) => node.id === selected);
  const visible = data?.nodes.filter((node) => node.name.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const links = (data?.links.filter((link) => link.source === selected || link.target === selected) ?? [])
    .sort((a, b) => b.similarity - a.similarity || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  const option = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const matching = new Set(visible.map((item) => item.id));
    const adjacent = new Set(links.map((item) => item.source === selected ? item.target : item.source));
    const colors = ["#0e7c6b", "#397d9a", "#b5853c", "#56855a", "#6d7083", "#aa7060", "#7b809c", "#728a46"];
    const groups = [...new Set(nodes.map((node) => node.cluster))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
    const sizes = groups.map((group) => nodes.filter((node) => node.cluster === group).length);
    const maxSize = Math.max(1, ...sizes);
    const groupSpacing = 100 + Math.sqrt(maxSize) * 44;
    const offsets = new Map<number | null, number>();
    return {
      backgroundColor: "transparent",
      animationDuration: reduce ? 0 : 400,
      tooltip: { show: true, renderMode: "richText", formatter: (params: { dataType?: string; name?: string }) => params.dataType === "node" ? params.name ?? "" : "" },
      series: [{
        type: "graph", layout: "none", roam: true, draggable: false,
        scaleLimit: { min: 0.45, max: 3 }, labelLayout: { hideOverlap: true },
        data: nodes.map((node) => {
          const groupIndex = groups.indexOf(node.cluster);
          const offset = offsets.get(node.cluster) ?? 0;
          offsets.set(node.cluster, offset + 1);
          const [groupX, groupY] = radialPosition(groupIndex, groupSpacing);
          const [localX, localY] = radialPosition(offset, 45);
          const dim = query.trim() && !matching.has(node.id);
          const active = node.id === selected;
          return {
            id: node.id, nodeId: node.id, name: node.name,
            x: groupX + localX, y: groupY + localY,
            symbolSize: offset === 0 && node.cluster !== null ? 19 : nodes.length > 100 ? 6 + Math.min(7, Math.sqrt(node.chunk_count)) : 9 + Math.min(13, Math.sqrt(node.chunk_count) * 2),
            itemStyle: { color: node.cluster === null ? "#a5aaa2" : colors[(node.cluster - 1) % colors.length], opacity: dim ? 0.18 : 1, borderColor: active ? "#fff7db" : "#fffdf8", borderWidth: active ? 3 : 1 },
            label: { show: true, position: "right", color: "#314b43", fontSize: active || adjacent.has(node.id) || offset === 0 ? 11 : 10, fontWeight: offset === 0 ? 600 : 400, opacity: dim ? 0.2 : 1 },
          };
        }),
        links: (data?.links ?? []).map((link) => ({
          source: link.source, target: link.target,
          lineStyle: { color: "#397c6c", width: link.source === selected || link.target === selected ? 1.7 : 0.7, opacity: link.source === selected || link.target === selected ? 0.65 : nodes.length > 100 ? 0.06 : 0.17, curveness: 0.08 },
        })),
        emphasis: { focus: "adjacency", label: { show: true } },
      }],
    } as Record<string, unknown>;
  }, [data, links, query, reduce, selected, visible]);

  return <div className="knowledge-graph-page keyword-graph">
    <section className="kg-summary" aria-label="关键词图谱概况">
      <div className="kg-summary-title"><span className="kg-summary-icon" aria-hidden="true"><Network size={22} /></span><div><strong>文档关键词星图</strong><span>按段落共现自动分组，组数较多时颜色循环使用。</span></div></div>
      <div className="kg-stats"><span><strong>{data?.nodes.length ?? "—"}</strong>关键词</span><span><strong>{data?.links.length ?? "—"}</strong>关联</span><span><strong>{data?.document_count ?? "—"}</strong>来源文档</span></div>
    <div className="keyword-graph-controls" aria-label="星图范围与数量">
      <label><span>查看范围</span><select className="select" value={dossierId} onChange={(event) => setDossierId(event.target.value)}><option value="">整个知识库</option>{dossiers.map((dossier) => <option key={dossier.id} value={dossier.id}>{dossier.name}</option>)}</select></label>
      <label><span>关键词数量</span><select className="select" value={limit} onChange={(event) => setLimit(Number(event.target.value))}>{[10, 20, 50, 100, 200, 500].map((count) => <option key={count} value={count}>最多 {count} 个</option>)}</select></label>
    </div>
    </section>
    {dossierId && <p className="keyword-scope-note">包含卷宗内所有版本的材料</p>}
    {error ? <div className="panel keyword-graph-message" role="alert">图谱读取失败：{error} <button type="button" className="link-btn" onClick={() => setRetry((n) => n + 1)}>重试</button></div> : loading || !data ? <div className="panel keyword-graph-message" role="status">正在整理文档关键词…</div> : !data.nodes.length ? <div className="panel keyword-graph-message">当前范围暂无可提取的关键词，请先添加可读取文本的文档。</div> :
    <div className="kg-workbench">
      <aside className="panel keyword-list-panel">
        <div className="kg-panel-head"><span><Search size={16} />关键词</span><span>{visible.length} / {data.nodes.length}</span></div>
        <label className="keyword-search"><span className="sr-only">搜索关键词</span><input className="select" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词" /></label>
        <div className="keyword-list">{visible.map((node) => <button key={node.id} type="button" className={node.id === selected ? "is-active" : ""} aria-pressed={node.id === selected} onClick={() => setSelected(node.id)}><span>{node.name}</span><small>{node.chunk_count} 段</small></button>)}{!visible.length && <p>未找到匹配关键词</p>}</div>
      </aside>
      <section className="kg-canvas-panel" aria-label="文档关键词星图"><div className="kg-canvas-head"><div><Network size={17} /><strong>关键词关联</strong></div><span className="keyword-method">{data.method}</span></div><div className="kg-canvas"><EChart option={option} height="100%" className="kg-chart" ariaLabel={`文档关键词星图，${data.nodes.length} 个关键词，${data.links.length} 条关联。可使用关键词列表查看来源。`} onClick={(raw) => { const id = (raw as { data?: { nodeId?: string } }).data?.nodeId; if (id) setSelected(id); }} /><p className="kg-canvas-hint">文字重叠时自动避让 · 悬停查看词语 · 滚轮缩放</p></div></section>
      <aside className="panel keyword-detail"><div className="kg-panel-head"><span><BookOpen size={17} />关键词详情</span></div>{activeNode && <div className="keyword-detail-body"><h2>{activeNode.name}</h2><p>{activeNode.cluster === null ? "未聚类" : `聚类 ${activeNode.cluster}`} · 出现在 {activeNode.chunk_count} 个文本分块中</p><h3>相近关键词 · 共现相似度</h3><div className="keyword-neighbors">{links.length ? links.slice(0, 12).map((link) => { const other = link.source === selected ? link.target : link.source; return <button type="button" key={other} onClick={() => setSelected(other)}>{other}<small>{Math.round(link.similarity * 100)}%</small></button>; }) : <p>暂无足够的共现关联</p>}</div><h3>原文来源</h3>{activeNode.sources.map((source) => <div className="keyword-source" key={`${source.doc_id}:${source.chunk_idx}`}><Link to={`/library?doc=${encodeURIComponent(source.doc_id)}`}>{source.doc_name}</Link><small>{source.section || "正文"}{source.page ? ` · 第 ${source.page} 页` : ""}</small><p>{source.excerpt}</p></div>)}<p className="keyword-caveat">分组与关联根据文本共现自动计算，不代表因果、引用或人工认定的分类。</p></div>}</aside>
    </div>}
  </div>;
}
