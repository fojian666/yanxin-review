import { useMemo, type MouseEvent } from "react";

export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMarkdown(text: string): string {
  let s = escapeHtml(text || "");
  s = s.replace(/\[(\d{1,2})\]/g, '<span class="cite" data-idx="$1">[$1]</span>');
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const lines = s.split(/\n/);
  let html = "";
  let listType: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    let match = line.match(/^[-*•]\s+(.*)$/);
    if (match) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${match[1]}</li>`;
      continue;
    }
    match = line.match(/^\d+[.、)]\s+(.*)$/);
    if (match) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${match[1]}</li>`;
      continue;
    }
    closeList();
    if (/^#{1,4}\s+/.test(line)) {
      html += `<p><strong>${line.replace(/^#{1,4}\s+/, "")}</strong></p>`;
    } else {
      html += `<p>${line}</p>`;
    }
  }
  closeList();
  return html || "<p></p>";
}

interface MarkdownProps {
  content: string;
  onCite?: (index: number) => void;
  className?: string;
}

export function Markdown({ content, onCite, className = "msg-content" }: MarkdownProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest(".cite") as HTMLElement | null;
    if (target && onCite) onCite(Number(target.dataset.idx));
  };
  return (
    <div
      className={className}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
