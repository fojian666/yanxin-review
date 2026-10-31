import type { LucideIcon } from "lucide-react";

export function WorkspaceRouteLoader({
  title,
  icon: Icon,
}: {
  title: string;
  icon: LucideIcon;
}) {
  return (
    <div className="workspace-route-loader" role="status" aria-live="polite" aria-atomic="true">
      <div className="workspace-route-loader-card">
        <div className="workspace-route-loader-visual" aria-hidden="true">
          <span className="workspace-route-loader-sheet is-back" />
          <span className="workspace-route-loader-sheet is-middle" />
          <span className="workspace-route-loader-sheet is-front">
            <Icon size={22} strokeWidth={1.7} />
          </span>
        </div>
        <div className="workspace-route-loader-copy">
          <strong>正在打开{title}</strong>
          <span>正在准备当前工作面与历史课题资料</span>
        </div>
        <span className="workspace-route-loader-track" aria-hidden="true">
          <span />
        </span>
      </div>
    </div>
  );
}
