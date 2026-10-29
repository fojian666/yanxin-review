import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../AppContext";
import { DocumentDirectory } from "../components/DocumentDirectory";
import { DocumentReader } from "../components/DocumentReader";
import { EmptyState } from "../components/EmptyState";
import { EASE } from "../motion";
import type { DocItem, DocumentContent } from "../types";

const KIND_RANK: Record<string, number> = {
  proposal: 0,
  guide: 1,
  template: 2,
  policy: 3,
  paper: 4,
  other: 5,
};

export function LibraryPage() {
  const {
    health,
    docs,
    dossiers,
    dossierOptions,
    papers,
    refreshDocs,
    refreshPapers,
    toast,
    openUpload,
    setSelectedDocs,
    setActiveDocId,
    setActiveDossierId,
    activeDocId,
    can,
    loading,
  } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const csvRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const contentRequest = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [dragging, setDragging] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [documentQuery, setDocumentQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState("");
  const [direction, setDirection] = useState<"next" | "prev" | "same">("same");
  const [uploadedDocId, setUploadedDocId] = useState("");
  const limitMb = health?.upload_limit_mb ?? 30;

  const orderedDocs = useMemo(
    () => [...docs].sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9)),
    [docs],
  );
  const requestedId = params.get("doc") || "";
  const requestedDoc = orderedDocs.find((doc) => doc.id === requestedId);
  const contextDoc = orderedDocs.find((doc) => doc.id === activeDocId);
  const uploadedDoc = orderedDocs.find((doc) => doc.id === uploadedDocId);
  const selected = uploadedDoc ?? requestedDoc ?? contextDoc ?? orderedDocs[0] ?? null;
  const selectedIndex = selected ? orderedDocs.findIndex((doc) => doc.id === selected.id) : -1;
  const previous = selectedIndex > 0 ? orderedDocs[selectedIndex - 1] : null;
  const next = selectedIndex >= 0 && selectedIndex < orderedDocs.length - 1 ? orderedDocs[selectedIndex + 1] : null;

  useEffect(() => {
    if (loading) return;
    if (requestedId && (!orderedDocs.length || !requestedDoc)) {
      const nextParams = new URLSearchParams(params);
      nextParams.delete("doc");
      setParams(nextParams, { replace: true });
    }
  }, [loading, orderedDocs.length, params, requestedDoc, requestedId, setParams]);

  useEffect(() => {
    if (uploadedDoc) {
      if (requestedId !== uploadedDoc.id) {
        const nextParams = new URLSearchParams(params);
        nextParams.set("doc", uploadedDoc.id);
        setParams(nextParams);
        if (uploadedDoc.kind === "proposal" || uploadedDoc.kind === "other") { setActiveDossierId(""); setActiveDocId(uploadedDoc.id); }
      } else {
        setUploadedDocId("");
      }
    }
  }, [params, requestedId, setActiveDocId, setActiveDossierId, setParams, uploadedDoc]);

  useEffect(() => {
    const onUploaded = (event: Event) => {
      const doc = (event as CustomEvent<DocItem>).detail;
      if (doc?.id) setUploadedDocId(doc.id);
    };
    window.addEventListener("yanxin:document-uploaded", onUploaded);
    return () => window.removeEventListener("yanxin:document-uploaded", onUploaded);
  }, []);

  useEffect(() => {
    if (!selected) {
      contentRequest.current += 1;
      setContent(null);
      setLoadingContent(false);
      setContentError("");
      return;
    }
    let active = true;
    const requestId = ++contentRequest.current;
    setLoadingContent(true);
    setContentError("");
    setContent(null);
    void api.documentContent(selected.id)
      .then((result) => {
        if (active && requestId === contentRequest.current) setContent(result);
      })
      .catch((err) => {
        if (active && requestId === contentRequest.current) setContentError((err as Error).message);
      })
      .finally(() => {
        if (active && requestId === contentRequest.current) setLoadingContent(false);
      });
    return () => { active = false; };
  }, [selected?.id]);

  const chooseDocument = (doc: DocItem) => {
    const current = selected ? orderedDocs.findIndex((item) => item.id === selected.id) : -1;
    const target = orderedDocs.findIndex((item) => item.id === doc.id);
    setDirection(current < 0 || target === current ? "same" : target > current ? "next" : "prev");
    const nextParams = new URLSearchParams(params);
    nextParams.set("doc", doc.id);
    setParams(nextParams);
    if (doc.kind === "proposal" || doc.kind === "other") { setActiveDossierId(""); setActiveDocId(doc.id); }
    if (window.matchMedia("(max-width: 900px)").matches) {
      setDirectoryOpen(false);
      requestAnimationFrame(() => readerRef.current?.focus({ preventScroll: true }));
    }
  };

  const openForChat = (doc: DocItem) => {
    if (doc.kind === "proposal" || doc.kind === "other") { setActiveDossierId(""); setActiveDocId(doc.id); }
    setSelectedDocs([doc.id]);
    navigate("/chat");
  };

  const openForReview = (doc: DocItem) => {
    if (doc.kind === "proposal" || doc.kind === "other") { setActiveDossierId(""); setActiveDocId(doc.id); }
    navigate(`/review?doc=${doc.id}`);
  };

  const deleteDocument = async (doc: DocItem) => {
    if (!confirm(`确定删除《${doc.name}》及其索引？`)) return;
    const fallback = next ?? previous;
    setDeletingId(doc.id);
    try {
      await api.deleteDocument(doc.id);
      await Promise.all([refreshDocs(), refreshPapers()]);
      const nextParams = new URLSearchParams(params);
      if (fallback) nextParams.set("doc", fallback.id);
      else nextParams.delete("doc");
      if (mounted.current) setParams(nextParams, { replace: true });
      toast("文档已删除");
    } catch (err) {
      toast(`删除失败：${(err as Error).message}`, "error");
    } finally {
      setDeletingId(null);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
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

  const hasSample = papers.some((paper) => paper.is_sample === 1);

  return (
    <div className={dragging ? "library-page document-center is-dragging" : "library-page document-center"}>
      <section
        className="document-center-bar"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="document-center-title">
          <span className="document-center-mark" aria-hidden="true"><UploadCloud size={20} /></span>
          <div>
            <strong>资料在册 · 目录可循</strong>
            <span>{docs.length} 份资料 · 文件上限 {limitMb}MB · 拖入页面即可上传</span>
          </div>
        </div>
        <div className="document-center-tools">
          {can("upload") && (
            <button type="button" className="btn btn-primary" onClick={() => openUpload()}>
              <UploadCloud size={15} />上传文档
            </button>
          )}
          {can("delete-doc") && (
            <button type="button" className="btn btn-ghost danger" onClick={() => void removeSampleDocs()}>
              移除演示本子
            </button>
          )}
        </div>
      </section>

      <div className="document-center-layout">
        <aside className={directoryOpen ? "document-directory-shell is-open" : "document-directory-shell"}>
          <button
            type="button"
            className="document-directory-toggle"
            aria-expanded={directoryOpen}
            aria-controls="document-directory-panel"
            onClick={() => setDirectoryOpen((open) => !open)}
          >
            <span>文档目录</span>
            <strong>{selected?.name || "暂无文档"}</strong>
          </button>
          <div id="document-directory-panel">
            <DocumentDirectory
              docs={orderedDocs}
              dossiers={dossiers}
              materialRoles={dossierOptions?.material_roles ?? []}
              selectedId={selected?.id || ""}
              query={documentQuery}
              onQueryChange={setDocumentQuery}
              onSelect={chooseDocument}
            />
          </div>
        </aside>

        <DocumentReader
          content={content}
          selected={selected}
          loading={loadingContent}
          error={contentError}
          direction={direction}
          position={Math.max(1, selectedIndex + 1)}
          total={orderedDocs.length}
          previous={previous}
          next={next}
          canDelete={can("delete-doc")}
          deleting={deletingId === selected?.id}
          readerRef={readerRef}
          onNavigate={chooseDocument}
          onAsk={openForChat}
          onReview={openForReview}
          onDelete={(doc) => void deleteDocument(doc)}
          onRetry={() => {
            if (!selected) return;
            const requestId = ++contentRequest.current;
            setContentError("");
            setLoadingContent(true);
            setContent(null);
            void api.documentContent(selected.id)
              .then((result) => {
                if (requestId === contentRequest.current) setContent(result);
              })
              .catch((err) => {
                if (requestId === contentRequest.current) setContentError((err as Error).message);
              })
              .finally(() => {
                if (requestId === contentRequest.current) setLoadingContent(false);
              });
          }}
        />
      </div>

      <details className="panel document-literature">
        <summary>
          <span><FileSpreadsheet size={17} />文献数据</span>
          <span>{papers.length} 篇 · 趋势分析数据</span>
        </summary>
        <div className="document-literature-body">
          <div className="document-literature-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>
              <Download size={14} />下载 CSV 模板
            </button>
            {can("import") && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => csvRef.current?.click()}>
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
          <AnimatePresence initial={false}>
            {hasSample && (
              <motion.div
                className="sample-note"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.34, ease: EASE }}
              >
                当前包含演示文献，趋势结论仅用于功能验证。
                {can("remove-sample") && <button type="button" className="link-btn danger" onClick={() => void clearSamples()}>移除演示文献</button>}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="table-wrap scroll-area">
            {papers.length === 0 ? (
              <EmptyState icon={<FileText size={32} />} description="文献尚空。导入 CSV，趋势分析即可成图。" />
            ) : (
              <table className="data-table">
                <thead><tr><th>标题</th><th>年份</th><th>关键词</th><th>来源</th></tr></thead>
                <tbody>
                  {papers.slice(0, 100).map((paper) => (
                    <tr key={paper.id}>
                      <td><div className="doc-title" title={paper.title}>{paper.title}</div></td>
                      <td>{paper.year ?? "—"}</td>
                      <td>{paper.keywords}</td>
                      <td>{paper.is_sample ? <span className="badge-sample">演示</span> : paper.source === "csv" ? "CSV 导入" : "上传"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </details>

      {dragging && <div className="document-drop-overlay" aria-hidden="true"><UploadCloud size={28} />松开以上传文档</div>}
    </div>
  );
}
