import { motion } from "framer-motion";
import { Loader2, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../AppContext";
import { EmptyState } from "../components/EmptyState";
import { WorkDeck, type WorkDeckStep } from "../components/WorkDeck";
import { EASE, staggerContainer, staggerItem } from "../motion";
import { ROLE_LABELS, type UserRole } from "../types";

interface UserRow {
  username: string;
  role: string;
  display_name: string;
  created_at: string;
}

type AdminSection = "users" | "create" | "roles";

const ADMIN_STEPS: WorkDeckStep<AdminSection>[] = [
  { id: "users", label: "用户与角色", hint: "查看现有账号" },
  { id: "create", label: "新建用户", hint: "填写账号与角色" },
  { id: "roles", label: "权限说明", hint: "四类角色边界" },
];

export function AdminPage() {
  const { toast } = useApp();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ username: "", password: "", role: "viewer", display_name: "" });
  const [busy, setBusy] = useState(false);
  const [highlightUser, setHighlightUser] = useState("");
  const [section, setSection] = useState<AdminSection>("users");

  const load = useCallback(async () => {
    try {
      const data = await api.listUsers();
      setUsers(data.users);
      setRoles(data.roles);
    } catch (err) {
      toast(`用户列表加载失败：${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (busy) return;
    if (!form.username.trim() || form.password.length < 6) {
      toast("请填写用户名，密码至少 6 位", "error");
      return;
    }
    setBusy(true);
    const username = form.username.trim();
    try {
      await api.createUser({
        username,
        password: form.password,
        role: form.role,
        display_name: form.display_name.trim(),
      });
      toast(`已创建用户 ${username}`);
      setForm({ username: "", password: "", role: "viewer", display_name: "" });
      await load();
      setHighlightUser(username);
      setSection("users");
    } catch (err) {
      toast(`创建失败：${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page admin-deck-workspace">
      <WorkDeck
        className="admin-deck"
        steps={ADMIN_STEPS}
        active={section}
        onChange={setSection}
        ariaLabel="用户管理工作台"
        status={<span className="count-badge">{users.length} 人</span>}
        panels={{
          users: (
            <div className="panel admin-deck-page admin-users-page">
              <div className="panel-head"><div><div className="panel-title-row"><h2>用户与角色</h2><span className="count-badge">{users.length}</span></div></div></div>
              <div className="table-wrap" role="region" aria-label="用户列表" tabIndex={0}>
                {loading ? <div className="empty-state"><Loader2 size={30} className="spin" /></div> : users.filter(Boolean).length === 0 ? <EmptyState icon={<Users size={38} />} description="尚无用户，创建第一位吧。" /> : (
                  <table className="data-table">
                    <thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>创建时间</th></tr></thead>
                    <tbody>{users.filter(Boolean).map((user) => <motion.tr key={user.username} className={user.username === highlightUser ? "row-flash" : undefined} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.23, ease: EASE }}><td><div className="doc-title">{user.username}</div></td><td>{user.display_name}</td><td><span className={`role-badge role-${user.role}`}>{roles[user.role] || user.role}</span></td><td>{(user.created_at || "").replace("T", " ")}</td></motion.tr>)}</tbody>
                  </table>
                )}
              </div>
            </div>
          ),
          create: (
            <div className="panel admin-create admin-deck-page">
              <div className="panel-head"><div><h2>新建用户</h2><p>密码至少 6 位，创建后可立即登录。</p></div></div>
              <div className="form-grid admin-create-form">
                <label className="field"><span>用户名</span><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="如 zhangsan" disabled={busy} /></label>
                <label className="field"><span>密码（≥6 位）</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="设置初始密码" autoComplete="new-password" disabled={busy} /></label>
                <label className="field"><span>角色</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} disabled={busy}>{(["admin", "manager", "reviewer", "viewer"] as UserRole[]).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></label>
                <label className="field"><span>姓名（可选）</span><input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} placeholder="显示名称" disabled={busy} /></label>
              </div>
              <div className="admin-actions"><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <><Loader2 size={16} className="spin" />创建中…</> : <><UserPlus size={16} />创建用户</>}</button></div>
            </div>
          ),
          roles: (
            <div className="panel admin-deck-page admin-role-page">
              <div className="panel-head"><div><h2>角色能力</h2><p>界面权限与后端角色校验使用同一矩阵。</p></div></div>
              <motion.div className="role-matrix" variants={staggerContainer} initial="initial" animate="animate">
                {[
                  { role: "admin", text: "全部功能，含用户管理" },
                  { role: "manager", text: "上传/删除文档、导入文献与专家、外部推送" },
                  { role: "reviewer", text: "问答、预审、查重匹配、文献趋势、知识图谱；文档中心只读" },
                  { role: "viewer", text: "问答与文献趋势（只读演示）" },
                ].map((item) => <motion.div className="role-matrix-item" key={item.role} variants={staggerItem}><span className={`role-badge role-${item.role}`}>{ROLE_LABELS[item.role as UserRole]}</span><span>{item.text}</span></motion.div>)}
              </motion.div>
            </div>
          ),
        }}
      />
    </div>
  );
}
