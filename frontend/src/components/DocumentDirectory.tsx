import { ChevronRight, FileText } from "lucide-react";
import type { DocItem, Dossier, DossierOption } from "../types";

const REFERENCE_GROUPS = [
  { kind: "policy", label: "政策" },
  { kind: "guide", label: "流程与手册" },
  { kind: "template", label: "空白模板" },
  { kind: "paper", label: "文献" },
];

interface DocumentDirectoryProps {
  docs: DocItem[];
  dossiers: Dossier[];
  materialRoles: DossierOption[];
  selectedId: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (doc: DocItem) => void;
}

export function DocumentDirectory({
  docs,
  dossiers,
  materialRoles,
  selectedId,
  query,
  onQueryChange,
  onSelect,
}: DocumentDirectoryProps) {
  const normalized = query.trim().toLocaleLowerCase();
  const visible = normalized
    ? docs.filter((doc) => doc.name.toLocaleLowerCase().includes(normalized))
    : docs;

  // 一个文档可属于多个卷宗、承担不同角色；每个角色内只列一次。
  const rolesByDoc = new Map<string, Set<string>>();
  for (const dossier of dossiers) {
    for (const material of dossier.materials) {
      const roles = rolesByDoc.get(material.doc_id) ?? new Set<string>();
      roles.add(material.role);
      rolesByDoc.set(material.doc_id, roles);
    }
  }
  const projectDocs = visible.filter((doc) => rolesByDoc.has(doc.id) || !["policy", "guide", "template"].includes(doc.kind));
  const roles = materialRoles.length ? materialRoles : [{ value: "proposal_text", label: "申请书（可编辑版）", short: "申请书" }, { value: "other", label: "其他卷宗材料", short: "其他材料" }];
  const projectGroups = roles.map((role) => ({
    label: role.short || role.label,
    key: role.value,
    items: projectDocs.filter((doc) => rolesByDoc.get(doc.id)?.has(role.value)),
  }));
  const knownRoles = new Set(roles.map((role) => role.value));
  const unassigned = projectDocs.filter((doc) => {
    const assigned = rolesByDoc.get(doc.id);
    return !assigned || !Array.from(assigned).some((role) => knownRoles.has(role));
  });
  const proposals = unassigned.filter((doc) => doc.kind === "proposal");
  const proposalGroup = projectGroups.find((group) => group.key === "proposal_text");
  if (proposalGroup) proposalGroup.items.push(...proposals);
  projectGroups.push({ key: "unassigned", label: "未归类资料", items: unassigned.filter((doc) => doc.kind !== "proposal" && doc.kind !== "paper") });
  const referenceGroups = REFERENCE_GROUPS.map((group) => ({
    key: group.kind,
    label: group.label,
    items: visible.filter((doc) => doc.kind === group.kind && (doc.kind !== "paper" || unassigned.includes(doc))),
  }));
  const categories = [
    { label: "课题材料", groups: projectGroups },
    { label: "公共与参考资料", groups: referenceGroups },
  ];

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
          {categories.map((category) => {
            const groups = category.groups.filter((group) => group.items.length);
            if (!groups.length) return null;
            return (
              <details className="document-directory-category" key={`${category.label}:${normalized ? "search" : "browse"}`} open>
                <summary><h2>{category.label}</h2><ChevronRight size={14} aria-hidden="true" /></summary>
                {groups.map((group) => (
                  <details className="document-directory-group" key={`${group.key}:${normalized ? "search" : "browse"}`} open>
                    <summary><h3>{group.label}<span>{group.items.length}</span></h3><ChevronRight size={13} aria-hidden="true" /></summary>
                    {group.items.map((doc) => (
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
                  </details>
                ))}
              </details>
            );
          })}
        </nav>
      )}
    </div>
  );
}
