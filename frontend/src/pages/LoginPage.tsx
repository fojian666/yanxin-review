import {
  Eye, EyeOff, FileSearch, Loader2, LogIn, MapPinned,
  ScanSearch, ShieldCheck, TrendingUp, Users,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import type { UserRole } from "../types";

const DEMO_ACCOUNTS: {
  username: UserRole; label: string; desc: string; icon: typeof ShieldCheck;
}[] = [
  { username: "admin", label: "管理员", desc: "统揽全局", icon: ShieldCheck },
  { username: "manager", label: "科研管理", desc: "收文入库", icon: FileSearch },
  { username: "reviewer", label: "评审专家", desc: "勘验比对", icon: ScanSearch },
  { username: "viewer", label: "访客", desc: "阅卷观势", icon: Eye },
];

const FEATURES = [
  { icon: FileSearch, label: "引用溯源", desc: "查看引用原文与位置" },
  { icon: ScanSearch, label: "文本查重", desc: "查看相似段落与依据" },
  { icon: Users, label: "专家匹配", desc: "结合回避条件和负载" },
  { icon: TrendingUp, label: "文献趋势", desc: "查看文献数量和主题变化" },
];

const DEMO_PASSWORD = "yanxin2026";

const TERRAIN_PATHS = [
  "M-120 170 C 140 60, 300 280, 520 160 S 880 60, 1090 210 S 1360 300, 1560 150",
  "M-120 230 C 150 120, 320 340, 540 220 S 900 120, 1110 270 S 1380 360, 1580 210",
  "M-140 620 C 120 500, 300 720, 520 600 S 880 500, 1100 650 S 1380 740, 1580 590",
  "M-140 690 C 130 570, 320 790, 540 670 S 900 570, 1120 720 S 1400 810, 1600 660",
  "M-140 760 C 140 640, 330 860, 560 740 S 920 640, 1140 790 S 1420 880, 1620 730",
];

const FLOW_PATHS = [
  "M-140 460 C 160 330, 360 600, 620 430 S 1000 300, 1240 470 S 1520 620, 1640 430",
  "M-140 780 C 140 640, 340 900, 600 730 S 980 600, 1220 770 S 1500 900, 1640 740",
];

export function LoginPage() {
  const { login } = useApp();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    document.title = "登录 · 研信智评";
    // 小屏自动聚焦会把上方品牌区滚出视口，只在桌面端聚焦
    if (!window.matchMedia("(max-width: 680px)").matches) nameRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { clientX, clientY } = event;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const page = pageRef.current;
      if (!page) return;
      const width = window.innerWidth || 1;
      const height = window.innerHeight || 1;
      page.style.setProperty("--px", ((clientX / width - 0.5) * 2).toFixed(3));
      page.style.setProperty("--py", ((clientY / height - 0.5) * 2).toFixed(3));
    });
  };

  const resetParallax = () => {
    pageRef.current?.style.setProperty("--px", "0");
    pageRef.current?.style.setProperty("--py", "0");
  };

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
      // 登录成功才置标记；刷新/会话恢复不会触发进入过渡
      try { sessionStorage.setItem("yanxin.enter", "1"); } catch { /* 忽略存储异常 */ }
      navigate("/welcome", { replace: true });
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
    <div
      className="login-page"
      ref={pageRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetParallax}
    >
      <span className="login-grid" aria-hidden="true" />
      <svg
        className="login-terrain login-terrain-far"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <g>
          {TERRAIN_PATHS.map((d) => <path key={d} d={d} />)}
        </g>
        <g className="login-terrain-rings">
          <ellipse cx="1180" cy="210" rx="160" ry="78" />
          <ellipse cx="1180" cy="210" rx="120" ry="58" />
          <ellipse cx="1180" cy="210" rx="80" ry="38" />
          <ellipse cx="240" cy="720" rx="140" ry="66" />
          <ellipse cx="240" cy="720" rx="100" ry="47" />
          <ellipse cx="240" cy="720" rx="60" ry="28" />
        </g>
      </svg>
      <svg
        className="login-terrain login-terrain-near"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <g>
          {FLOW_PATHS.map((d) => (
            <path key={d} className="login-flow-line" pathLength={1} d={d} />
          ))}
        </g>
      </svg>
      <span className="login-orb login-orb-a" aria-hidden="true" />
      <span className="login-orb login-orb-b" aria-hidden="true" />
      <span className="login-orb login-orb-c" aria-hidden="true" />
      <span className="login-grain" aria-hidden="true" />

        <div className="login-card">
          <div className="login-brand">
            <span className="login-side-label" aria-hidden="true">自然资源 · 科研诚信</span>
            <div className="login-sheet-meta">
              <span>JIANGSU · NATURAL RESOURCES</span>
              <span>32°03′N · 118°47′E</span>
            </div>
            <svg
              className="login-contours"
              viewBox="0 0 400 620"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              <g className="login-contour-lines">
                <path pathLength={1} d="M-50 20 C 80 -30, 200 80, 340 10 S 500 60, 470 140" />
                <path pathLength={1} d="M-50 96 C 70 20, 180 150, 320 70 S 470 130, 430 210" />
                <path pathLength={1} d="M-50 136 C 80 60, 190 190, 330 110 S 480 170, 440 250" />
                <path pathLength={1} d="M-50 176 C 90 100, 200 230, 340 150 S 490 210, 450 290" />
                <path pathLength={1} d="M-70 390 C 50 310, 160 440, 290 370 S 430 430, 430 530" />
                <path pathLength={1} d="M-70 430 C 60 350, 170 480, 300 410 S 440 470, 440 570" />
                <path pathLength={1} d="M-70 470 C 70 390, 180 520, 310 450 S 450 510, 450 610" />
                <path pathLength={1} d="M-60 300 C 80 230, 190 350, 330 280 S 480 340, 450 420" />
                <path pathLength={1} d="M-60 340 C 90 270, 210 390, 350 320 S 500 380, 460 460" />
                <path pathLength={1} d="M-60 540 C 70 470, 180 590, 310 520 S 450 580, 450 670" />
                <path pathLength={1} d="M-60 590 C 80 520, 190 640, 320 570 S 460 630, 460 720" />
                <path
                  id="login-active-contour"
                  className="login-contour-active"
                  pathLength={1}
                  d="M-30 250 C 90 170, 210 300, 350 220 S 500 280, 460 360"
                />
              </g>
              <circle className="login-survey" r="3.2">
                <animateMotion dur="16s" begin="0.8s" repeatCount="indefinite">
                  <mpath href="#login-active-contour" />
                </animateMotion>
              </circle>
              <g className="login-contour-peak">
                <ellipse cx="300" cy="150" rx="86" ry="44" />
                <ellipse cx="300" cy="150" rx="62" ry="31" />
                <ellipse cx="300" cy="150" rx="38" ry="19" />
                <circle cx="300" cy="150" r="3" />
              </g>
              <g className="login-contour-peak">
                <ellipse cx="96" cy="500" rx="54" ry="28" />
                <ellipse cx="96" cy="500" rx="34" ry="17" />
                <circle cx="96" cy="500" r="2.5" />
              </g>
            </svg>
            <span className="login-scan" aria-hidden="true" />

            <div className="login-seal-wrap">
              <span className="login-seal-ring" aria-hidden="true" />
              <div className="login-seal">研</div>
            </div>
            <div className="login-domain">
              <MapPinned size={13} /> 自然资源 · 科研诚信 · 江苏
            </div>
            <h1>研信智评</h1>
            <p className="login-brand-sub">科研项目评审辅助工作台</p>
            <div className="login-features-head">
              <span>核心能力</span>
            </div>
            <div className="login-features">
              {FEATURES.map(({ icon: Icon, label, desc }, index) => (
                <div
                  className="login-feature"
                  key={label}
                  style={{ animationDelay: `${0.12 + index * 0.07}s` }}
                >
                  <span className="login-feature-icon"><Icon size={15} /></span>
                  <div>
                    <strong>{label}</strong>
                    <small>{desc}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="login-foot">
              <span className="login-lan-badge">默认本机访问</span>
              <span>江苏省自然资源科研课题 · 首期原型</span>
            </div>
          </div>

          <form className="login-form" onSubmit={submit}>
            <div className="login-form-head">
              <h2>登录</h2>
              <p>使用内网账号登录</p>
            </div>
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
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>
            {error && <div className="login-error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? <><Loader2 size={16} className="spin" />登录中…</> : <><LogIn size={16} />登 录</>}
            </button>
            <div className="login-secure-note">
              <ShieldCheck size={13} /> 会话经 HttpOnly Cookie 保护 · 材料不出内网
            </div>
            <div className="login-demo">
              <div className="login-demo-title">
                演示账号 <code>{DEMO_PASSWORD}</code> · 点击填充
              </div>
              <div className="login-demo-grid">
                {DEMO_ACCOUNTS.map(({ username, label, desc, icon: Icon }) => (
                  <button
                    type="button"
                    key={username}
                    className={`login-demo-chip role-${username}`}
                    onClick={() => fillDemo(username)}
                    title={`${username} · ${desc}`}
                    disabled={busy}
                  >
                    <span className="login-demo-icon"><Icon size={13} /></span>
                    <strong>{label}</strong>
                    <small>{username} · {desc}</small>
                  </button>
                ))}
              </div>
              <div className="login-demo-note">
                演示账号仅限内网验证；正式使用请由管理员创建账号或接统一身份认证。
              </div>
            </div>
          </form>
        </div>
      </div>
  );
}
