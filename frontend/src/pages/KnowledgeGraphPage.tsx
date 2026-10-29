import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  GitBranch,
  Network,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { EChart } from "../components/EChart";
import { useMotionPreference } from "../motion";
import {
  CATEGORY_META,
  GRAPH_STATS,
  KNOWLEDGE_LINKS,
  KNOWLEDGE_NODES,
  findShortestPath,
  getNeighbors,
  getNode,
  type KnowledgeCategory,
  type KnowledgeNode,
} from "../data/knowledge";

const CATEGORY_ORDER: KnowledgeCategory[] = [
  "lifecycle",
  "integrity",
  "review",
  "knowledge",
  "intelligence",
  "application",
  "security",
];

const CLUSTER_POSITIONS: Record<KnowledgeCategory, { x: number; y: number }> = {
  lifecycle: { x: -430, y: -245 },
  integrity: { x: -440, y: 185 },
  review: { x: -165, y: 340 },
  knowledge: { x: 20, y: -320 },
  intelligence: { x: 390, y: -180 },
  application: { x: 420, y: 235 },
  security: { x: -130, y: 40 },
};

const HUBS = new Set([
  "root",
  "proposal",
  "integrity",
  "policyClause",
  "expertMatch",
  "knowledgeGraph",
  "rag",
  "llm",
  "farmland",
  "humanReview",
  "intranetDeployment",
]);

const degrees = new Map<string, number>(KNOWLEDGE_NODES.map((item) => [item.id, 0]));
for (const relation of KNOWLEDGE_LINKS) {
  degrees.set(relation.source, (degrees.get(relation.source) ?? 0) + 1);
  degrees.set(relation.target, (degrees.get(relation.target) ?? 0) + 1);
}

const positions = new Map<string, { x: number; y: number }>([["root", { x: 0, y: 0 }]]);
CATEGORY_ORDER.forEach((category, categoryIndex) => {
  const center = CLUSTER_POSITIONS[category];
  const members = KNOWLEDGE_NODES.filter((item) => item.category === category && item.id !== "root");
  members.forEach((item, index) => {
    const angle = index * 2.31 + categoryIndex * 0.74;
    const radius = 54 + Math.sqrt(index) * 43;
    let x = center.x + Math.cos(angle) * radius;
    let y = center.y + Math.sin(angle) * radius * 0.7;
    if (HUBS.has(item.id)) {
      x = center.x + (x - center.x) * 0.72;
      y = center.y + (y - center.y) * 0.72;
    }
    positions.set(item.id, { x, y });
  });
});

function pathPairs(path: KnowledgeNode[] | null) {
  const pairs = new Set<string>();
  for (let index = 0; index < (path?.length ?? 0) - 1; index += 1) {
    const a = path![index].id;
    const b = path![index + 1].id;
    pairs.add(`${a}|${b}`);
    pairs.add(`${b}|${a}`);
  }
  return pairs;
}

export function KnowledgeGraphPage() {
  const navigate = useNavigate();
  const reduce = useMotionPreference();
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");
  const [selectedId, setSelectedId] = useState(() => (focus && getNode(focus) ? focus : "root"));
  const [hidden, setHidden] = useState<Set<KnowledgeCategory>>(() => new Set());
  const [search, setSearch] = useState("");
  const [pathFrom, setPathFrom] = useState("proposal");
  const [pathTo, setPathTo] = useState("humanReview");
  const [path, setPath] = useState<KnowledgeNode[] | null>(null);
  const [pathError, setPathError] = useState("");

  useEffect(() => {
    if (focus && getNode(focus)) setSelectedId(focus);
  }, [focus]);

  const selected = getNode(selectedId) ?? getNode("root")!;
  const neighbors = getNeighbors(selected.id);
  const pathIds = new Set((path ?? []).map((item) => item.id));
  const activePathPairs = pathPairs(path);
  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return [];
    const relatedIds = new Set(KNOWLEDGE_LINKS.filter((relation) =>
      relation.rel.toLocaleLowerCase().includes(query)
    ).flatMap((relation) => [relation.source, relation.target]));
    return KNOWLEDGE_NODES.filter((item) =>
      relatedIds.has(item.id) || [item.name, item.id, item.desc, ...Object.entries(item.props ?? {}).flat()]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query)
    ).slice(0, 8);
  }, [search]);

  const chooseNode = (id: string) => {
    setSelectedId(id);
    const next = new URLSearchParams(params);
    next.set("focus", id);
    setParams(next);
  };

  const graphOption = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const matches = new Set(searchResults.map((item) => item.id));
    const adjacent = new Set(neighbors.map((item) => item.node.id));
    adjacent.add(selected.id);

    const nodes = [
      ...KNOWLEDGE_NODES.map((item) => {
        const position = positions.get(item.id) ?? { x: 0, y: 0 };
        const meta = CATEGORY_META[item.category];
        const degree = degrees.get(item.id) ?? 0;
        const isRoot = item.id === "root";
        const isSelected = item.id === selected.id;
        const isNeighbor = adjacent.has(item.id);
        const isPath = pathIds.has(item.id);
        const isMatch = matches.has(item.id);
        const dimmed = hidden.has(item.category) || (Boolean(query) && !isMatch);
        return {
          id: item.id,
          nodeId: item.id,
          name: item.name,
          x: position.x,
          y: position.y,
          category: CATEGORY_ORDER.indexOf(item.category),
          symbolSize: isRoot ? 38 : HUBS.has(item.id) ? 18 + Math.min(10, degree * 0.7) : 9 + Math.min(10, degree),
          value: degree,
          itemStyle: {
            color: dimmed ? `${meta.color}3d` : meta.color,
            borderColor: isPath ? "#9eead8" : isSelected ? "#fff6d5" : isMatch ? "#ffd67a" : "#fffdf8",
            borderWidth: isSelected || isPath ? 3 : isNeighbor ? 1.7 : 1,
            shadowBlur: isSelected || isPath ? 22 : 6,
            shadowColor: isSelected || isPath ? meta.color : `${meta.color}66`,
            opacity: dimmed ? 0.2 : 1,
          },
          label: {
            show: true,
            position: "right",
            distance: 5,
            color: dimmed ? "#8d9e96" : isSelected ? "#174d43" : "#314b43",
            fontSize: isRoot || HUBS.has(item.id) ? 11 : 10,
            fontWeight: isRoot || isSelected ? 600 : 400,
            textBorderColor: "#f8f7ef",
            textBorderWidth: 2,
            opacity: dimmed ? 0.28 : 1,
          },
          emphasis: {
            itemStyle: { borderColor: "#fff6d5", borderWidth: 2.5, shadowBlur: 24 },
            label: { color: "#173d36", fontSize: 11 },
          },
        };
      }),
      ...CATEGORY_ORDER.map((category) => {
        const meta = CATEGORY_META[category];
        const center = CLUSTER_POSITIONS[category];
        return {
          id: `__category_${category}`,
          nodeId: "",
          name: meta.label,
          x: center.x,
          y: center.y - 92,
          category: CATEGORY_ORDER.indexOf(category),
          symbolSize: 0.1,
          value: 0,
          itemStyle: { color: "transparent", opacity: 0 },
          label: {
            show: !hidden.has(category),
            position: "inside",
            formatter: meta.label,
            color: meta.color,
            fontSize: 10,
            fontWeight: 600,
            backgroundColor: "#fbfaf4",
            borderColor: `${meta.color}88`,
            borderWidth: 1,
            borderRadius: 4,
            padding: [4, 8],
          },
          silent: true,
        };
      }),
    ];

    const links = KNOWLEDGE_LINKS.map((item) => {
      const source = getNode(item.source)!;
      const target = getNode(item.target)!;
      const isPath = activePathPairs.has(`${item.source}|${item.target}`);
      const isAdjacent = item.source === selected.id || item.target === selected.id;
      const dimmed = hidden.has(source.category) || hidden.has(target.category);
      const searchDim = Boolean(query) && !matches.has(item.source) && !matches.has(item.target);
      return {
        source: item.source,
        target: item.target,
        value: item.rel,
        lineStyle: {
          color: isPath ? "#166c59" : isAdjacent ? "#477e6e" : CATEGORY_META[source.category].color,
          width: isPath ? 2.8 : isAdjacent ? 1.5 : 0.7,
          opacity: dimmed ? 0.025 : searchDim ? 0.04 : isPath ? 0.95 : isAdjacent ? 0.68 : 0.3,
          curveness: 0.08,
        },
      };
    });

    return {
      backgroundColor: "transparent",
      animationDuration: reduce ? 0 : 620,
      animationDurationUpdate: reduce ? 0 : 360,
      tooltip: {
        backgroundColor: "#fffdf7",
        borderColor: "#a6bbb0",
        textStyle: { color: "#263f37", fontSize: 12 },
        confine: true,
        formatter: (raw: unknown) => {
          const data = (raw as { data?: { nodeId?: string } }).data;
          const item = data?.nodeId ? getNode(data.nodeId) : undefined;
          if (!item) return "";
          return `<strong>${item.name}</strong><br/><span>${CATEGORY_META[item.category].label} · 关联 ${degrees.get(item.id) ?? 0}</span><br/>${item.desc.slice(0, 72)}…`;
        },
      },
      series: [{
        type: "graph",
        layout: "none",
        roam: true,
        draggable: false,
        data: nodes,
        links,
        categories: CATEGORY_ORDER.map((category) => ({
          name: CATEGORY_META[category].label,
          itemStyle: { color: CATEGORY_META[category].color },
        })),
        labelLayout: { hideOverlap: true },
        emphasis: { focus: "adjacency", lineStyle: { width: 1.8 } },
        scaleLimit: { min: 0.34, max: 2.8 },
      }],
    } as Record<string, unknown>;
  }, [activePathPairs, hidden, neighbors, pathIds, reduce, search, searchResults, selected.id]);

  const toggleCategory = (category: KnowledgeCategory) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else if (next.size < CATEGORY_ORDER.length - 1) next.add(category);
      return next;
    });
  };

  const runPath = () => {
    const result = findShortestPath(pathFrom, pathTo);
    setPath(result);
    setPathError(result ? "" : "两个实体在当前图谱中不连通");
  };

  const askModel = () => {
    navigate(`/chat?prompt=${encodeURIComponent(`请解释“${selected.name}”在研信智评中的作用，并说明它与其他概念的关系。`)}`);
  };

  return (
    <div className="knowledge-graph-page">
      <section className="kg-summary" aria-label="知识图谱概况">
        <div className="kg-summary-title">
          <span className="kg-summary-icon" aria-hidden="true"><Network size={22} /></span>
          <div>
            <strong>科研治理语义网络</strong>
            <span>人工整理科研治理概念及关系，供探索与核对。</span>
          </div>
        </div>
        <div className="kg-stats">
          <span><strong>{GRAPH_STATS.nodes}</strong>实体</span>
          <span><strong>{GRAPH_STATS.links}</strong>关系</span>
          <span><strong>{GRAPH_STATS.categories}</strong>知识域</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={askModel}>
          <Sparkles size={15} />让大模型解读
        </button>
      </section>

      <div className="kg-workbench">
        <aside className="kg-side">
          <section className="panel kg-control">
            <div className="kg-panel-head">
              <span><BookOpen size={17} />知识域</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => setHidden(new Set())}
                disabled={hidden.size === 0}
              >
                <RotateCcw size={12} /> 重置
              </button>
            </div>
            <div className="kg-domain-list">
              {CATEGORY_ORDER.map((category) => {
                const meta = CATEGORY_META[category];
                const count = KNOWLEDGE_NODES.filter((item) => item.category === category).length;
                const visible = !hidden.has(category);
                return (
                  <button
                    key={category}
                    type="button"
                    className={visible ? "" : "is-hidden"}
                    aria-pressed={visible}
                    onClick={() => toggleCategory(category)}
                  >
                    <i style={{ background: meta.color }} />
                    <span>{meta.label}</span>
                    <b>{count}</b>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel kg-control kg-path-panel">
            <div className="kg-panel-head">
              <span><GitBranch size={17} />最短关系路径</span>
            </div>
            <div className="kg-path-selects">
              <label>
                <span>起点</span>
                <select className="select" value={pathFrom} onChange={(event) => { setPathFrom(event.target.value); setPath(null); }}>
                  {KNOWLEDGE_NODES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                <span>终点</span>
                <select className="select" value={pathTo} onChange={(event) => { setPathTo(event.target.value); setPath(null); }}>
                  {KNOWLEDGE_NODES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={runPath}>
              <GitBranch size={14} />推演语义路径
            </button>
            {pathError && <p className="kg-path-error" role="alert">{pathError}</p>}
            {path && (
              <div className="kg-path-result" aria-live="polite">
                <div className="kg-path-result-head">
                  <span>路径 · {Math.max(0, path.length - 1)} 跳</span>
                  <button type="button" onClick={() => setPath(null)} aria-label="清除路径"><X size={13} /></button>
                </div>
                <div className="kg-path-chain">
                  {path.map((item, index) => (
                    <span key={item.id}>
                      <button type="button" onClick={() => chooseNode(item.id)}>{item.name}</button>
                      {index < path.length - 1 && <ArrowRight size={11} />}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </aside>

        <section className="kg-canvas-panel" aria-label="语义星图">
          <div className="kg-canvas-head">
            <div>
              <Network size={17} />
              <strong>语义星图</strong>
            </div>
            <label className="kg-search">
              <Search size={14} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="检索实体、属性或关系"
                aria-label="检索知识图谱"
              />
              {search && <button type="button" onClick={() => setSearch("")} aria-label="清空图谱搜索"><X size={12} /></button>}
            </label>
          </div>
          <div className="kg-canvas">
            <EChart
              option={graphOption}
              height="100%"
              className="kg-chart"
              ariaLabel={`科研治理知识图谱，共 ${GRAPH_STATS.nodes} 个实体、${GRAPH_STATS.links} 条关系。可用右侧实体详情和邻接关系访问全部内容。`}
              onClick={(raw) => {
                const id = (raw as { data?: { nodeId?: string } }).data?.nodeId;
                if (id) chooseNode(id);
              }}
            />
            {search && (
              <div className="kg-search-results">
                {searchResults.length ? searchResults.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      chooseNode(item.id);
                      setSearch("");
                    }}
                  >
                    <i style={{ background: CATEGORY_META[item.category].color }} />
                    <span><strong>{item.name}</strong><em>{CATEGORY_META[item.category].label}</em></span>
                    <ChevronRight size={13} />
                  </button>
                )) : <p>未找到匹配实体</p>}
              </div>
            )}
            <div className="kg-legend">
              {CATEGORY_ORDER.map((category) => (
                <span key={category}><i style={{ background: CATEGORY_META[category].color }} />{CATEGORY_META[category].short}</span>
              ))}
            </div>
            <p className="kg-canvas-hint">拖动平移 · 滚轮缩放 · 点击节点查看详情</p>
          </div>
        </section>

        <aside className="kg-side kg-detail-column">
          <section className="panel kg-detail">
            <div className="kg-panel-head">
              <span><BookOpen size={17} />实体详情</span>
              <span className="kg-category" style={{ color: CATEGORY_META[selected.category].color }}>
                {CATEGORY_META[selected.category].label}
              </span>
            </div>
            <div className="kg-detail-head">
              <span style={{ background: CATEGORY_META[selected.category].color }}>{selected.name.slice(0, 1)}</span>
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.source}</p>
              </div>
            </div>
            <p className="kg-detail-desc">{selected.desc}</p>
            {selected.props && (
              <dl className="kg-props">
                {Object.entries(selected.props).map(([key, value]) => (
                  <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            )}
            <div className="kg-relations-head">
              <strong>关联关系</strong>
              <span>{neighbors.length} · 度数 {degrees.get(selected.id) ?? 0}</span>
            </div>
            <div className="kg-relations">
              {neighbors.map((item) => (
                <button type="button" key={`${item.direction}-${item.node.id}`} onClick={() => chooseNode(item.node.id)}>
                  <span>{item.direction === "out" ? "→" : "←"}</span>
                  <b style={{ color: CATEGORY_META[item.node.category].color }}>{item.node.name}</b>
                  <em>{item.rel}</em>
                  <ChevronRight size={12} />
                </button>
              ))}
            </div>
            <div className="kg-detail-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setPathFrom(selected.id);
                  if (pathTo === selected.id) setPathTo(selected.id === "root" ? "proposal" : "root");
                  setPath(null);
                  setPathError("");
                }}
              >
                <GitBranch size={14} />从这里推理
              </button>
              <button type="button" className="btn btn-primary" onClick={askModel}>
                <Sparkles size={14} />让大模型解释
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
