import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useMotionPreference } from "../motion";
import type { DocItem, DocumentContent } from "../types";

interface DocumentReaderProps {
  content: DocumentContent | null;
  selected: DocItem | null;
  loading: boolean;
  error: string;
  direction: "next" | "prev" | "same";
  position: number;
  total: number;
  previous: DocItem | null;
  next: DocItem | null;
  canDelete: boolean;
  deleting: boolean;
  readerRef: React.RefObject<HTMLElement | null>;
  onNavigate: (doc: DocItem) => void;
  onAsk: (doc: DocItem) => void;
  onReview: (doc: DocItem) => void;
  onDelete: (doc: DocItem) => void;
  onRetry: () => void;
}

const KIND_LABELS: Record<string, string> = {
  proposal: "申报书",
  policy: "政策",
  guide: "流程指南",
  template: "空白模板",
  paper: "文献",
  other: "资料",
};

export function DocumentReader({
  content,
  selected,
  loading,
  error,
  direction,
  position,
  total,
  previous,
  next,
  canDelete,
  deleting,
  readerRef,
  onNavigate,
  onAsk,
  onReview,
  onDelete,
  onRetry,
}: DocumentReaderProps) {
  const reduce = useMotionPreference();
  const waiting = loading || (!content && !error);

  if (!selected) {
    return (
      <section className="document-reader document-reader-empty" aria-label="文档正文">
        <p>选择左侧文档，在这里阅读正文与核对依据。</p>
      </section>
    );
  }

  const sourceLabel = selected.source === "public"
    ? "公开政策"
    : selected.source === "demo"
      ? "演示数据"
      : "本机资料";

  return (
    <section
      ref={readerRef}
      className="document-reader"
      aria-label="文档正文"
      aria-busy={waiting || undefined}
      tabIndex={-1}
    >
      <div className="document-page-spine" aria-hidden="true" />
      <header className="document-reader-head">
        <div>
          <span className="document-kind">{KIND_LABELS[selected.kind] ?? "资料"}</span>
          <h2>{selected.name}</h2>
          <div className="document-meta-line">
            <span>{sourceLabel}</span>
            {selected.year && <span>{selected.year}</span>}
            <span>{selected.chunk_count} 个文本块</span>
            <span>{selected.status === "ready" ? "已索引" : "待处理"}</span>
          </div>
          {selected.warning && <p className="document-reader-warning">{selected.warning}</p>}
        </div>
        <span className="document-folio">PAGE {String(position).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
      </header>

      <div className="document-reader-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAsk(selected)}>
          <MessageSquareText size={14} />文档问答
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReview(selected)}>
          <ShieldCheck size={14} />发起预审
        </button>
        {canDelete && (
          <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => onDelete(selected)} disabled={deleting}>
            {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            {deleting ? "删除中…" : "删除文档"}
          </button>
        )}
      </div>

      <motion.div
        className="document-reader-body"
        role="region"
        aria-label="文档内容，可滚动"
        tabIndex={0}
        key={content?.document.id || "loading"}
        initial={!content || reduce || direction === "same" ? false : {
          rotateY: direction === "next" ? -8 : 8,
          x: direction === "next" ? 16 : -16,
          opacity: 0.82,
          transformPerspective: 1000,
        }}
        animate={{ rotateY: 0, x: 0, opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.54, ease: [0.22, 1, 0.36, 1] }}
      >
        {waiting ? (
          <div className="document-reader-loading" role="status">
            <Loader2 size={22} className="spin" />
            <span>正在展开文档…</span>
          </div>
        ) : error ? (
          <div className="document-reader-error" role="alert">
            <strong>文档读取失败</strong>
            <p>{error}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>重新读取</button>
          </div>
        ) : !content?.chunks.length ? (
          <div className="document-reader-empty">
            <p>该文档尚未生成可阅读文本。请检查原文或重新上传。</p>
          </div>
        ) : (
          <div className="document-prose">
            {content.chunks.map((chunk, index) => {
              const previousSection = index > 0 ? content.chunks[index - 1].section : "";
              return (
                <section className="document-chunk" key={chunk.idx}>
                  {chunk.section && chunk.section !== previousSection && chunk.section !== content.document.name && <h3>{chunk.section}</h3>}
                  <div className="document-chunk-text">{chunk.text}</div>
                  {chunk.page && <span className="document-page-ref">第 {chunk.page} 页</span>}
                </section>
              );
            })}
          </div>
        )}
      </motion.div>

      <footer className="document-reader-pager">
        {previous ? (
          <button type="button" className="document-pager-button" title={`上一份：${previous.name}`} aria-label={`上一份：${previous.name}`} onClick={() => onNavigate(previous)}>
            <ChevronLeft size={16} />
            <span><small>上一份</small><span className="document-pager-title">{previous.name}</span></span>
          </button>
        ) : <span />}
        <span className="document-folio">PAGE {String(position).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
        {next ? (
          <button type="button" className="document-pager-button is-next" title={`下一份：${next.name}`} aria-label={`下一份：${next.name}`} onClick={() => onNavigate(next)}>
            <span><small>下一份</small><span className="document-pager-title">{next.name}</span></span>
            <ChevronRight size={16} />
          </button>
        ) : <span />}
      </footer>
    </section>
  );
}
