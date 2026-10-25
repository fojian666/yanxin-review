import { motion } from "framer-motion";
import {
  ArrowRight, FolderOpen, MessageSquareText, ShieldCheck, TrendingUp, UserCog, Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useApp } from "../AppContext";
import { EASE, prefersReducedMotion, staggerContainer, staggerItem } from "../motion";
import { ROLE_LABELS, type UserRole } from "../types";

interface Entry {
  to: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  permission?: string;
}

const ENTRIES: Entry[] = [
  { to: "/chat", title: "智能问答", desc: "从一句话开始，读到原文与页码", icon: MessageSquareText },
  { to: "/trend", title: "文献趋势", desc: "在多年文献里读热度、读空白", icon: TrendingUp },
  { to: "/match", title: "查重匹配", desc: "段落比对与专家匹配，约束前置", icon: Users, permission: "tool" },
  { to: "/review", title: "本子预审", desc: "形式、诚信、查重、政策四关", icon: ShieldCheck, permission: "review" },
  { to: "/library", title: "文档库", desc: "资料入库，索引在册", icon: FolderOpen },
  { to: "/admin", title: "用户管理", desc: "账号与角色，权限在册", icon: UserCog, permission: "admin" },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "上午好";
  if (hour < 14) return "午间好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function WelcomePage() {
  const { auth, can } = useApp();
  const reduce = prefersReducedMotion();
  const entries = ENTRIES.filter((item) => !item.permission || can(item.permission));
  const role = auth ? ROLE_LABELS[auth.role as UserRole] : "";
  const display = auth?.display_name || auth?.username || "";
  const named = Boolean(display) && display !== role;
  const name = named ? display : role;
  const showBadge = named && Boolean(role);

  return (
    <div className="welcome-home">
      <motion.section
        className="welcome-hero"
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: EASE }}
      >
        <div className="welcome-greeting-row">
          <h2>{greeting()}，{name}</h2>
          {showBadge && <span className={`role-badge role-${auth?.role}`}>{role}</span>}
        </div>
        <p>以诚信为尺，勘每一卷申报。</p>
        <div className="welcome-actions">
          <Link className="btn btn-primary" to="/chat">
            进入智能问答 <ArrowRight size={16} />
          </Link>
        </div>
      </motion.section>

      <motion.div
        className="welcome-entries"
        variants={staggerContainer}
        initial={reduce ? false : "initial"}
        animate="animate"
      >
        {entries.map(({ to, title, desc, icon: Icon }) => (
          <motion.div key={to} variants={staggerItem}>
            <Link className="welcome-card" to={to}>
              <span className="welcome-card-icon"><Icon size={19} /></span>
              <strong>{title}</strong>
              <small>{desc}</small>
              <ArrowRight size={15} className="welcome-card-arrow" />
            </Link>
          </motion.div>
        ))}
      </motion.div>

      <p className="welcome-disclaimer">
        AI 只提供检查项与证据，不打分、不排名、不替专家下结论；查重相似不等于抄袭，须人工复核。
      </p>
    </div>
  );
}
