import { motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight, FolderOpen, MessageSquareText, ShieldCheck, TrendingUp, UserCog, Users, type LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useApp } from "../AppContext";
import { SPRING } from "../motion";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
}

const NAV: NavItem[] = [
  { to: "/chat", label: "智能问答", icon: MessageSquareText },
  { to: "/trend", label: "文献趋势", icon: TrendingUp },
  { to: "/match", label: "查重匹配", icon: Users, permission: "tool" },
  { to: "/review", label: "本子预审", icon: ShieldCheck, permission: "review" },
  { to: "/library", label: "文档库", icon: FolderOpen },
];

export function Sidebar() {
  const { can, sidebarCollapsed, toggleSidebar } = useApp();
  const visible = NAV.filter((item) => !item.permission || can(item.permission));
  const nav: NavItem[] = can("admin")
    ? [...visible, { to: "/admin", label: "用户管理", icon: UserCog }]
    : visible;

  // 部分 webview 的 CSS 宽度过渡会冻结布局，改用 rAF 逐帧内联样式补间（每帧强制重排，可靠）
  // 滑动只动 transform（合成器路径）；主区瞬时切换——逐帧改 margin 会让
  // 嵌入式 webview 的渲染冻结在中间态（主面板显示一半），不能碰布局属性
  const animateSidebar = (toCollapsed: boolean) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const sb = document.querySelector<HTMLElement>(".sidebar");
    if (!sb) return;
    const DUR = 300;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    sb.style.width = "264px"; // class 已切换，动画期间以 264 宽滑动
    if (!toCollapsed) {
      sb.style.transform = "translateX(-180px)"; // 展开方向：从滑出位置起步
      void sb.offsetWidth; // 强制回流，确保起点生效
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DUR);
      const e = easeOutCubic(p);
      const shift = toCollapsed ? -180 * e : -180 * (1 - e);
      sb.style.transform = `translateX(${shift.toFixed(1)}px)`;
      if (p < 1) requestAnimationFrame(tick);
      else {
        // 落位：清除内联，交给样式表（折叠 84 / 展开 264，均无位移）
        sb.style.width = "";
        sb.style.transform = "";
      }
    };
    requestAnimationFrame(tick);
  };

  const onToggle = () => {
    animateSidebar(!sidebarCollapsed);
    toggleSidebar();
  };

  return (
    <aside className="sidebar" onDragStart={(event) => event.preventDefault()}>
      <div className="brand">
        <div className="brand-mark">研</div>
        <div className="brand-text">
          <div className="brand-name">研信智评</div>
          <div className="brand-sub">科研诚信智能评审</div>
        </div>
        <button
          className="icon-btn sidebar-toggle"
          onClick={onToggle}
          aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <nav className="nav">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            draggable={false}
            title={sidebarCollapsed ? label : undefined}
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="nav-pill"
                    className="nav-pill"
                    transition={SPRING}
                  />
                )}
                <Icon size={19} className="nav-icon" />
                <span className="nav-label">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-note">
          江苏省自然资源科研课题
          <br />
          首期原型 · 内网部署
        </div>
      </div>
    </aside>
  );
}
