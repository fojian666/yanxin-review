import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../AppContext";
import { SYSTEM_NAME } from "../branding";

const DEMO_ACCOUNTS = [
  { username: "admin", label: "管理员" },
  { username: "manager", label: "科研管理" },
  { username: "reviewer", label: "评审专家" },
  { username: "viewer", label: "访客" },
];

export function LoginPage() {
  const { login } = useApp();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `登录 · ${SYSTEM_NAME}`;
    if (!window.matchMedia("(max-width: 680px)").matches) nameRef.current?.focus();
    let active = true;
    const host = window.location.hostname;
    const local = host === "localhost" || host === "::1" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
    if (local) void api.health().then((health) => {
      if (active) setShowDemo(health.demo_login === true);
    }).catch(() => { /* 不影响正常登录 */ });
    return () => { active = false; };
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
      try { sessionStorage.setItem("yanxin.enter", "1"); } catch { /* 忽略存储异常 */ }
      navigate("/welcome", { replace: true });
    } catch (err) {
      setError((err as Error).message || "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="access-page">
      <header className="access-header"><h1>{SYSTEM_NAME}</h1></header>
      <div className="access-content">
        <section className="access-panel" aria-labelledby="access-title">
          <div className="access-panel-heading"><h2 id="access-title">账号登录</h2></div>
          <form className="access-form" onSubmit={submit} noValidate>
            <label className="field">
              <span>用户名</span>
              <input ref={nameRef} value={username} onChange={(event) => setUsername(event.target.value)}
                autoComplete="username" placeholder="请输入用户名" disabled={busy} required
                aria-invalid={Boolean(error)} aria-describedby={error ? "access-error" : undefined} />
            </label>
            <label className="field">
              <span>密码</span>
              <span className="access-password">
                <input type={showPassword ? "text" : "password"} value={password}
                  onChange={(event) => setPassword(event.target.value)} autoComplete="current-password"
                  placeholder="请输入密码" disabled={busy} required aria-invalid={Boolean(error)}
                  aria-describedby={error ? "access-error" : undefined} />
                <button type="button" onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            {error && <div id="access-error" className="access-error" role="alert">{error}</div>}
            <button className="access-submit" type="submit" disabled={busy}>
              {busy ? <><Loader2 size={17} className="spin" />登录中…</> : "登 录"}
            </button>
          </form>
          {showDemo && (
            <details className="access-demo">
              <summary>演示账号</summary>
              <div className="access-demo-list">
                {DEMO_ACCOUNTS.map((account) => (
                  <button type="button" key={account.username} disabled={busy} onClick={() => {
                    setUsername(account.username);
                    setPassword("yanxin2026");
                    setError("");
                    nameRef.current?.focus();
                  }}>{account.label}</button>
                ))}
              </div>
            </details>
          )}
        </section>
      </div>
    </main>
  );
}
