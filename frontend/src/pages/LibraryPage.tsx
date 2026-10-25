import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../AppContext";
import { EmptyState } from "../components/EmptyState";
import { EASE, staggerItem } from "../motion";

const KIND_LABELS: Record<string, string> = {
  proposal: "本子",
  policy: "政策",
  paper: "文献",
  other: "资料",
};

export function LibraryPage() {
  const { health, docs, papers, refreshDocs, refreshPapers, toast, openUpload, setSelectedDocs, can } = useApp();
  const navigate = useNavigate();
  const csvRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const limitMb = health?.upload_limit_mb ?? 30;

  const deleteDocument = async (id: string, name: string) => {
    if (!confirm(`确定删除《${name}》及其索引？`)) return;
    setDeletingId(id);
    try {
      await api.deleteDocument(id);
      await Promise.all([refreshDocs(), refreshPapers()]);
      toast("文档已删除");
    } catch (err) {
      toast(`删除失败：${(err as Error).message}`, "error");
    } finally {
      setDeletingId(null);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    openUpload(event.dataTransfer.files?.[0]);
  };

  const removeSampleDocs = async () => {
    if (!confirm("确定移除全部演示本子？上传的真实文档不受影响。")) return;
    try {
      const result = await api.removeSampleDocuments();
      await refreshDocs();
      toast(`已移除 ${result.removed || 0} 份演示本子`);
    } catch (err) {
      toast(`移除失败：${(err as Error).message}`, "error");
    }
  };

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await api.importPapers(file);
      await refreshPapers();
      toast(`已导入 ${result.count || 0} 篇文献`);
    } catch (err) {
      toast(`导入失败：${(err as Error).message}`, "error");
    }
  };

  const downloadTemplate = () => {
    const csv =
      "\uFEFF标题,年份,作者,期刊,摘要,关键词\n" +
      "面向自然资源科研诚信的风险预警研究,2024,张三,示例期刊,这里是摘要,科研诚信;风险预警\n" +
      "大模型辅助科研项目评审的方法研究,2025,李四,示例期刊,这里是摘要,大模型;专家评审\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "文献导入模板.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearSamples = async () => {
    if (!confirm("确定移除所有演示文献？导入的真实文献不受影响。")) return;
    try {
      const result = await api.removeSamplePapers();
      await refreshPapers();
      toast(`已移除 ${result.removed || 0} 篇演示文献`);
    } catch (err) {
      toast(`移除失败：${(err as Error).message}`, "error");
    }
  };

  const hasSample = papers.some((p) => p.is_sample === 1);

  return (
    <div className="library-page">
      {can("upload") && (
      <div className="panel upload-panel">
        <div
          className={`dropzone ${dragging ? "dragover" : ""}`}
          onClick={() => openUpload()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="drop-icon"><UploadCloud size={23} /></div>
          <h3>拖拽至此，或点击选择</h3>
          <p>支持 DOCX、PDF、TXT、MD；单个文件不超过 {limitMb}MB。扫描件暂未启用 OCR。</p>
          <button className="btn btn-primary" onClick={(event) => { event.stopPropagation(); openUpload(); }}>
            选择文件
          </button>
        </div>
      </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title-row">
              <h2>文档库</h2>
              <span className="count-badge">{docs.length} 份</span>
            </div>
            <p>上传件存于本机 data/uploads；政策语料来自 corpus/ 快照（删除后需重新导入）。删除文档，索引随之清除。</p>
          </div>
          {can("delete-doc") && (
            <button className="btn btn-ghost btn-sm danger" onClick={() => void removeSampleDocs()}>
              <Trash2 size={14} />移除演示本子
            </button>
          )}
        </div>
        <div className="table-wrap">
          {docs.length === 0 ? (
            <EmptyState
              icon={<FolderOpen size={38} />}
              description="库中尚空。上传一份本子或政策文件，即开始。"
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>文档</th><th>类型</th><th>年份</th><th>文本块</th><th>状态</th><th>操作</th></tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                {docs.map((doc, index) => (
                  <motion.tr
                    key={doc.id}
                    layout="position"
                    variants={staggerItem}
                    initial="initial"
                    animate="animate"
                    exit={{ opacity: 0, transition: { duration: 0.18, delay: 0 } }}
                    transition={{ duration: 0.29, ease: EASE, delay: Math.min(index * 0.035, 0.2) }}
                  >
                    <td>
                      <div className="doc-title" title={doc.name}>{doc.name}</div>
                      {doc.warning && <div className="muted doc-warning">{doc.warning}</div>}
                    </td>
                    <td>
                      <span className="kind-badge">{KIND_LABELS[doc.kind] ?? "资料"}</span>
                      {doc.source === "demo" && <span className="badge-sample">演示</span>}
                      {doc.source === "public" && (
                        <span className="badge-public" title="政府公开信息，来源见 corpus/sources.json">公开公文</span>
                      )}
                    </td>
                    <td>{doc.year ?? "—"}</td>
                    <td>{doc.chunk_count}</td>
                    <td>
                      <span className={`status-pill ${doc.status === "ready" ? "status-pass" : "status-warn"}`}>
                        {doc.status === "ready" ? "已索引" : "待处理"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="table-btn"
                          onClick={() => {
                            setSelectedDocs([doc.id]);
                            navigate("/chat");
                          }}
                        >
                          <MessageSquareText size={13} />问答
                        </button>
                        <button className="table-btn" onClick={() => navigate(`/review?doc=${doc.id}`)}>
                          <ShieldCheck size={13} />预审
                        </button>
                        {can("delete-doc") && (
                        <button
                          className="table-btn danger"
                          onClick={() => void deleteDocument(doc.id, doc.name)}
                          disabled={deletingId === doc.id}
                        >
                          {deletingId === doc.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                          {deletingId === doc.id ? "删除中…" : "删除"}
                        </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
                </AnimatePresence>
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>文献数据</h2>
            <p>供“历史沿革”趋势分析之用。CSV 批量导入，示例数据可随时移除。</p>
          </div>
          <div className="head-actions">
            <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}>
              <Download size={14} />下载 CSV 模板
            </button>
            {can("import") && (
            <button className="btn btn-ghost btn-sm" onClick={() => csvRef.current?.click()}>
              <FileSpreadsheet size={14} />导入文献 CSV
            </button>
            )}
            <input
              ref={csvRef}
              type="file"
              accept=".csv"
              hidden
              onChange={(event) => {
                void importCsv(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </div>
        <AnimatePresence initial={false}>
          {hasSample && (
            <motion.div
              className="sample-note"
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.34, ease: EASE }}
            >
              当前包含演示文献（合成数据），趋势结论仅用于功能验证。
              {can("remove-sample") && <button className="link-btn danger" onClick={() => void clearSamples()}>移除演示文献</button>}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="table-wrap scroll-area">
          {papers.length === 0 ? (
            <EmptyState
              icon={<FileText size={38} />}
              description="文献尚空。导入 CSV，趋势分析即可成图。"
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>标题</th><th>年份</th><th>关键词</th><th>来源</th></tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                {papers.slice(0, 100).map((paper, index) => (
                  <motion.tr
                    key={paper.id}
                    layout="position"
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.16, delay: 0 } }}
                    transition={{ duration: 0.34, ease: EASE, delay: Math.min(index * 0.012, 0.18) }}
                  >
                    <td><div className="doc-title" title={paper.title}>{paper.title}</div></td>
                    <td>{paper.year ?? "—"}</td>
                    <td>{paper.keywords}</td>
                    <td>
                      {paper.is_sample ? (
                        <span className="badge-sample">演示</span>
                      ) : paper.source === "csv" ? (
                        "CSV 导入"
                      ) : (
                        "上传"
                      )}
                    </td>
                  </motion.tr>
                ))}
                </AnimatePresence>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
