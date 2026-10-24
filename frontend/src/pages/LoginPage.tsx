import { motion } from "framer-motion";
import { Eye, EyeOff, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "../AppContext";
import { EASE } from "../motion";
import type { UserRole } from "../types";

const DEMO_ACCOUNTS: { username: UserRole; label: string; desc: string }[] = [
  { username: "admin", label: "管理员", desc: "全部功能 + 用户管理" },
  { username: "manager", label: "科研管理", desc: "上传/删除/导入/推送" },
  { username: "reviewer", label: "评审专家", desc: "问答/预审/查重匹配" },
  { username: "viewer", label: "访客", desc: "问答与趋势，只读" },
];

const DEMO_PASSWORD = "yanxin2026";

export function LoginPage() {
  const { login } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError((err as Error).message || "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = (user: string) => {
    setUsername(user);
    setPassword(DEMO_PASSWORD);
    setError("");
    nameRef.current?.focus();
  };

  return (
    <div className="login-page">
      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.34, ease: EASE }}
      >
        <div className="login-brand">
          <motion.div
            className="login-seal"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.34, ease: EASE, delay: 0.05 }}
          >
            研
          </motion.div>
          <h1>研信智评</h1>
          <p className="login-brand-sub">科研诚信智能评审 · 内网工作台</p>
          <ul className="login-points">
            <li><ShieldCheck size={14} /> 带原文引用的问答与预审</li>
            <li><ShieldCheck size={14} /> 语义查重与专家匹配一体化</li>
            <li><ShieldCheck size={14} /> 评审材料不出内网</li>
          </ul>
          <div className="login-foot">江苏省自然资源科研课题 · 首期原型</div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div className="eyebrow">SIGN IN</div>
          <h2>登录</h2>
          <label className="field">
            <span>用户名</span>
            <input
              ref={nameRef}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="请输入用户名"
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>密码</span>
            <div className="login-password">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="请输入密码"
                disabled={busy}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? <><Loader2 size={16} className="spin" />登录中…</> : <><LogIn size={16} />登 录</>}
          </button>
          <div className="login-demo">
            <div className="login-demo-title">演示账号（点击填充，密码统一 {DEMO_PASSWORD}）</div>
            <div className="login-demo-grid">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  type="button"
                  key={account.username}
                  className="login-demo-chip"
                  onClick={() => fillDemo(account.username)}
                  disabled={busy}
                >
                  <strong>{account.label}</strong>
                  <small>{account.username} · {account.desc}</small>
                </button>
              ))}
            </div>
            <div className="login-demo-note">演示账号仅限内网验证；正式使用请由管理员创建账号或接统一身份认证。</div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
