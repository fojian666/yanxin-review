import { ChevronRight, FileText } from "lucide-react";
import type { DocItem } from "../types";

const GROUPS: { kind: string; label: string }[] = [
  { kind: "proposal", label: "申报书" },
  { kind: "policy", label: "政策" },
  { kind: "guide", label: "流程与手册" },
  { kind: "template", label: "空白模板" },
  { kind: "paper", label: "文献" },
  { kind: "other", label: "其他资料" },
];

interface DocumentDirectoryProps {
  docs: DocItem[];
  selectedId: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (doc: DocItem) => void;
}

export function DocumentDirectory({
  docs,
  selectedId,
  query,
  onQueryChange,
  onSelect,
}: DocumentDirectoryProps) {
  const normalized = query.trim().toLocaleLowerCase();
  const visible = normalized
    ? docs.filter((doc) => doc.name.toLocaleLowerCase().includes(normalized))
    : docs;

  return (
    <div className="document-directory">
      <label className="document-directory-search">
        <span className="sr-only">筛选文档</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="筛选文档"
          aria-label="筛选文档"
        />
      </label>
      {visible.length === 0 ? (
        <div className="document-directory-empty">
          <FileText size={24} aria-hidden="true" />
          <p>{docs.length ? "没有匹配的文档" : "尚无文档"}</p>
        </div>
      ) : (
        <nav aria-label="文档目录">
          {GROUPS.map((group) => {
            const items = visible.filter((doc) => doc.kind === group.kind);
            if (!items.length) return null;
            return (
              <section className="document-directory-group" key={group.kind}>
                <h3>{group.label}<span>{items.length}</span></h3>
                {items.map((doc) => (
                  <button
                    type="button"
                    key={doc.id}
                    className={doc.id === selectedId ? "is-active" : ""}
                    aria-current={doc.id === selectedId ? "page" : undefined}
                    onClick={() => onSelect(doc)}
                  >
                    <span className="document-directory-icon" aria-hidden="true"><FileText size={13} /></span>
                    <span className="document-directory-copy">
                      <strong>{doc.name}</strong>
                      <small>
                        {doc.status === "ready" ? "已索引" : "待处理"}
                        {doc.year ? ` · ${doc.year}` : ""}
                        {doc.source === "public" ? " · 公开" : ""}
                      </small>
                    </span>
                    <ChevronRight size={12} aria-hidden="true" />
                  </button>
                ))}
              </section>
            );
          })}
        </nav>
      )}
    </div>
  );
}
