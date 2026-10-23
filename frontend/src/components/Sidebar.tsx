import { motion } from "framer-motion";
import { FolderOpen, MessageSquareText, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useApp } from "../AppContext";
import { SPRING } from "../motion";

const NAV = [
  { to: "/chat", label: "智能问答", icon: MessageSquareText },
  { to: "/trend", label: "文献趋势", icon: TrendingUp },
  { to: "/match", label: "查重匹配", icon: Users },
  { to: "/review", label: "本子预审", icon: ShieldCheck },
  { to: "/library", label: "文档库", icon: FolderOpen },
];

export function Sidebar() {
  const { health } = useApp();
  const online = Boolean(health?.llm.configured);
  return (
    <aside className="sidebar" onDragStart={(event) => event.preventDefault()}>
      <div className="brand">
        <div className="brand-mark">研</div>
        <div className="brand-text">
          <div className="brand-name">研信智评</div>
          <div className="brand-sub">科研诚信智能评审</div>
        </div>
      </div>

      <nav className="nav">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            draggable={false}
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
        <div className={`llm-status ${online ? "online" : ""}`}>
          <span className="status-dot" />
          <div>
            <div className="status-title">{online ? "千问已连接" : "离线演示模式"}</div>
            <div className="status-sub">
              {online ? health?.llm.model : "检索式回答 · 可配置千问"}
            </div>
          </div>
        </div>
        <div className="sidebar-note">
          江苏省自然资源科研课题
          <br />
          首期原型 · 内网部署
        </div>
      </div>
    </aside>
  );
}
