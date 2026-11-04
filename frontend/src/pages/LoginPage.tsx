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
        <div className="access-landscape" aria-hidden="true">
          <svg viewBox="0 0 720 560" preserveAspectRatio="xMidYMid meet">
            <g fill="none" stroke="currentColor">
              <path d="M-55 125 C95 10 191 190 320 91 S551 6 772 120" />
              <path d="M-55 153 C95 38 191 218 320 119 S551 34 772 148" />
              <path d="M-55 181 C95 66 191 246 320 147 S551 62 772 176" />
              <path d="M-55 209 C95 94 191 274 320 175 S551 90 772 204" />
              <path d="M-55 237 C95 122 191 302 320 203 S551 118 772 232" />
              <path d="M-55 265 C95 150 191 330 320 231 S551 146 772 260" />
              <path d="M-55 293 C95 178 191 358 320 259 S551 174 772 288" />
              <path d="M-55 321 C95 206 191 386 320 287 S551 202 772 316" />
              <path d="M-55 349 C95 234 191 414 320 315 S551 230 772 344" />
              <path d="M-55 377 C95 262 191 442 320 343 S551 258 772 372" />
              <path d="M-55 405 C95 290 191 470 320 371 S551 286 772 400" />
              <path d="M-55 433 C95 318 191 498 320 399 S551 314 772 428" />
            </g>
          </svg>
        </div>
        <section className="access-panel" aria-labelledby="access-title">
          <div className="access-panel-heading"><h2 id="access-title">账号登录</h2><span aria-hidden="true" /></div>
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
