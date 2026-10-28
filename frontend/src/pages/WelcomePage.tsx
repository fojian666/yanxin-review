import { motion } from "framer-motion";
import {
  ArrowRight, FolderOpen, MessageSquareText, ShieldCheck, TrendingUp, Upload, UserCog, Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useApp } from "../AppContext";
import { EASE, MOTION, useMotionPreference, useSessionEntrance, staggerContainer, staggerItem } from "../motion";
import { ROLE_LABELS, type UserRole } from "../types";

interface Entry {
  to: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  permission?: string;
}

const ENTRIES: Entry[] = [
  { to: "/chat", title: "智能问答", desc: "根据资料提问，查看原文", icon: MessageSquareText },
  { to: "/trend", title: "文献趋势", desc: "查看文献数量与主题变化", icon: TrendingUp },
  { to: "/match", title: "查重匹配", desc: "文本查重与专家匹配", icon: Users, permission: "tool" },
  { to: "/review", title: "本子预审", desc: "检查申报书并查看依据", icon: ShieldCheck, permission: "review" },
  { to: "/library", title: "文档库", desc: "管理申报书、政策与文献", icon: FolderOpen },
  { to: "/admin", title: "用户管理", desc: "管理账号与角色", icon: UserCog, permission: "admin" },
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
  const { auth, can, docs, loading, openUpload } = useApp();
  const reduce = useMotionPreference();
  const unfold = useSessionEntrance("yanxin.dossier-entrance");
  const priority = can("review")
    ? ["/review", "/match", "/chat", "/trend", "/library", "/admin"]
    : ["/chat", "/trend", "/library"];
  const entries = ENTRIES.filter((item) => !item.permission || can(item.permission))
    .sort((a, b) => priority.indexOf(a.to) - priority.indexOf(b.to));
  const proposalCount = docs.filter((doc) => doc.kind === "proposal").length;
  const policyCount = docs.filter((doc) => doc.kind === "policy").length;
  const role = auth ? ROLE_LABELS[auth.role as UserRole] : "";
  const display = auth?.display_name || auth?.username || "";
  const named = Boolean(display) && display !== role;
  const name = named ? display : role;
  const showBadge = named && Boolean(role);

  return (
    <div className="welcome-home">
      <motion.section
        className="welcome-hero"
        initial={reduce ? false : { opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : MOTION.enter, ease: EASE }}
      >
        <div className="welcome-intro">
        <div className="welcome-greeting-row">
          <h2>{greeting()}，{name}</h2>
          {showBadge && <span className={`role-badge role-${auth?.role}`}>{role}</span>}
        </div>
        <div className="welcome-actions">
          {can("upload") ? (
            <button className="btn btn-primary" onClick={() => openUpload()}><Upload size={16} />上传文档</button>
          ) : (
            <Link className="btn btn-primary" to={can("review") ? "/review" : "/chat"}>
              {can("review") ? "开始预审" : "进入智能问答"}<ArrowRight size={16} />
            </Link>
          )}
          <Link className="btn btn-ghost" to={can("upload") ? "/review" : "/library"}>
            {can("upload") ? "预审申报书" : "查看资料库"}<ArrowRight size={16} />
          </Link>
        </div>
        </div>
        <div className="welcome-register" aria-label="资料库概况">
          <div className={`dossier-art ${unfold ? "is-unfolding" : ""}`} aria-hidden="true">
            <div className="dossier-leaf dossier-leaf-back" />
            <div className="dossier-leaf dossier-leaf-mid" />
            <div className="dossier-leaf dossier-leaf-front">
              <span className="dossier-binding" />
              <span className="dossier-caption">研信智评 · 科研卷宗</span>
              <span className="dossier-title">以信立卷</span>
              <span className="dossier-rules"><i /><i /><i /></span>
              <span className="dossier-bookmark">卷</span>
            </div>
            <span className="dossier-shadow" />
          </div>
          <strong>资料在册，随时可查</strong>
          <span>{loading ? "正在读取资料库…" : `${docs.length} 份资料 · ${proposalCount} 份申报书 · ${policyCount} 份政策`}</span>
          <Link to="/library">打开文档库<ArrowRight size={14} /></Link>
        </div>
      </motion.section>

      <motion.nav
        className="welcome-entries"
        aria-label="工作台功能"
        variants={staggerContainer}
        initial={reduce ? false : "initial"}
        animate="animate"
      >
        {entries.map(({ to, title, desc, icon: Icon }, index) => (
          <motion.div key={to} variants={staggerItem}>
            <Link className={`welcome-card ${index < 2 ? "welcome-card-priority" : ""}`} to={to}>
              <span className="welcome-card-icon"><Icon size={19} /></span>
              <strong>{title}</strong>
              <small>{desc}</small>
              <ArrowRight size={15} className="welcome-card-arrow" />
            </Link>
          </motion.div>
        ))}
      </motion.nav>

      <p className="welcome-disclaimer">
        AI 只提供检查项与证据，不打分、不排名、不替专家下结论；查重相似不等于抄袭，须人工复核。
      </p>
    </div>
  );
}
