import { AnimatePresence, motion } from "framer-motion";
import { FileText, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { api } from "../api";
import { useApp } from "../AppContext";

export function UploadModal() {
  const { health, uploadOpen, setUploadOpen, uploadSeedFile, clearUploadSeed, refreshDocs, refreshPapers, toast } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("auto");
  const [year, setYear] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const limitMb = health?.upload_limit_mb ?? 30;

  useEffect(() => {
    if (!uploadOpen) return;
    setFile(uploadSeedFile ?? null);
    setKind("auto");
    setYear("");
    setTitle("");
    setBusy(false);
    setProgress(0);
    setDragging(false);
    clearUploadSeed();
    // Only initialize when the modal opens; the seed is consumed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadOpen]);

  // 对话框无障碍：焦点陷阱、ESC 关闭、锁定背景滚动、关闭后归还焦点
  useEffect(() => {
    if (!uploadOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    card?.focus();
    const focusables = () =>
      Array.from(
        card?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => el.offsetParent !== null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        setUploadOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!card?.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === card)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const root = document.documentElement;
    const body = document.body;
    const prevRoot = root.style.overflow;
    const prevBody = body.style.overflow;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = prevRoot;
      body.style.overflow = prevBody;
      previous?.focus();
    };
  }, [uploadOpen, setUploadOpen]);

  const pickFile = (picked: File | null | undefined) => {
    if (!picked) return;
    const suffix = (picked.name.split(".").pop() || "").toLowerCase();
    if (!["docx", "pdf", "txt", "md"].includes(suffix)) {
      toast("仅支持 DOCX / PDF / TXT / MD", "error");
      return;
    }
    if (picked.size > limitMb * 1024 * 1024) {
      toast(`文件超过 ${limitMb}MB`, "error");
      return;
    }
    setFile(picked);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    pickFile(event.dataTransfer.files?.[0]);
  };

  // 年份只允许数字、最多 4 位；范围在提交时校验
  const onYearChange = (value: string) => {
    setYear(value.replace(/\D/g, "").slice(0, 4));
  };

  const submit = async () => {
    if (!file) {
      toast("请先选择文件", "error");
      return;
    }
    const y = year.trim();
    if (y && (+y < 1990 || +y > 2035)) {
      toast("年份需在 1990–2035 之间", "error");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const result = await api.uploadDocument(file, { kind, year, title }, setProgress);
      await Promise.all([refreshDocs(), refreshPapers()]);
      toast(result.warning || "文档已上传并建立索引");
      setUploadOpen(false);
    } catch (err) {
      toast(`上传失败：${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const uploading = busy && progress < 100;

  return (
    <AnimatePresence>
      {uploadOpen && (
        <motion.div
          className="modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="modal-backdrop" onClick={() => !busy && setUploadOpen(false)} />
          <motion.div
            ref={cardRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="上传文档"
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.34 }}
          >
            <div className="modal-head">
              <div>
                <div className="eyebrow">UPLOAD</div>
                <h2>上传文档</h2>
              </div>
              <button className="icon-btn" onClick={() => setUploadOpen(false)} aria-label="关闭" disabled={busy}>
                <X size={18} />
              </button>
            </div>

            <div
              className={`modal-drop ${dragging ? "dragover" : ""}`}
              role="button"
              tabIndex={0}
              aria-label="选择要上传的文件"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <div className="drop-icon small">
                {file ? <FileText size={22} /> : <UploadCloud size={22} />}
              </div>
              <p>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : `点击选择或拖拽 DOCX / PDF / TXT / MD（≤ ${limitMb}MB）`}</p>
              <input
                ref={inputRef}
                type="file"
                accept=".docx,.pdf,.txt,.md"
                hidden
                onChange={(event) => pickFile(event.target.files?.[0])}
              />
            </div>

            <div className="form-grid">
              <label className="field">
                <span>资料类型</span>
                <select value={kind} onChange={(event) => setKind(event.target.value)} disabled={busy}>
                  <option value="auto">自动判断</option>
                  <option value="proposal">本子 / 申报书</option>
                  <option value="policy">政策 / 管理办法</option>
                  <option value="paper">文献 / 论文</option>
                  <option value="other">其他资料</option>
                </select>
              </label>
              <label className="field">
                <span>年份（可选）</span>
                <input
                  type="number"
                  min={1990}
                  max={2035}
                  inputMode="numeric"
                  value={year}
                  onChange={(event) => onYearChange(event.target.value)}
                  placeholder="如 2024"
                  disabled={busy}
                />
              </label>
              <label className="field span-2">
                <span>标题（可选）</span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="留空则自动取文件名或正文首行"
                  disabled={busy}
                />
              </label>
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setUploadOpen(false)} disabled={busy}>
                取消
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy ? (uploading ? `上传中 ${progress}%` : "解析中…") : "开始上传"}
              </button>
            </div>
            {busy && (
              <div className="upload-progress" role="status" aria-live="polite">
                <span />
                <em>{uploading ? `正在上传 ${progress}%` : "服务器解析与建立索引中…"}</em>
                <div className={`upload-bar ${uploading ? "determinate" : ""}`}>
                  <i style={uploading ? { width: `${progress}%` } : undefined} />
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
