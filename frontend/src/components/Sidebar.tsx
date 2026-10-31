import { motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { visibleWorkspaceViews } from "../data/workspaceViews";
import { SPRING } from "../motion";

export function Sidebar({ navOpen = false, onClose }: { navOpen?: boolean; onClose?: () => void }) {
  const { can, sidebarCollapsed, toggleSidebar } = useApp();
  const { pathname } = useLocation();
  const nav = visibleWorkspaceViews(can);
  const workspacePath = pathname === "/welcome" ? (can("review") ? "/review" : "/chat") : pathname;
  const asideRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const animationRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(animationRef.current), []);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // 移动端抽屉：打开时聚焦首个导航项、Tab 循环、ESC 关闭，关闭后焦点还给菜单按钮
  useEffect(() => {
    if (!navOpen) {
      if (wasOpen.current) {
        wasOpen.current = false;
        document.querySelector<HTMLElement>(".mobile-nav-btn")?.focus();
      }
      return;
    }
    wasOpen.current = true;
    const aside = asideRef.current;
    const items = () =>
      Array.from(aside?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
        .filter((el) => el.getClientRects().length > 0);
    // 等抽屉的 visibility 切换生效后再接管焦点；从首个导航项开始，而不是品牌链接
    const firstNav = aside?.querySelector<HTMLElement>(".nav-item");
    const initialFocus = document.activeElement;
    const focusFirstIfNeeded = () => {
      const active = document.activeElement;
      const trigger = document.querySelector<HTMLElement>(".mobile-nav-btn");
      // 只有焦点仍在触发按钮或页面时才补焦点，尊重用户已选的抽屉控件。
      if (!aside?.contains(active) && (active === initialFocus || active === trigger || active === document.body)) (firstNav ?? items()[0])?.focus();
    };
    const raf = requestAnimationFrame(focusFirstIfNeeded);
    // 抽屉刚关闭又打开时 visibility 可能仍处于退场阶段；退场结束后再核对一次。
    const focusRetry = window.setTimeout(focusFirstIfNeeded, 300);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!aside?.contains(active)) {
        // 焦点落在遮罩/页面其他位置时拉回抽屉
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(focusRetry);
      document.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);

  // 滑动只动 transform（合成器路径）；主区瞬时切换——逐帧改 margin 会让
  // 嵌入式 webview 的渲染冻结在中间态（主面板显示一半），不能碰布局属性
  const animateSidebar = (toCollapsed: boolean) => {
    cancelAnimationFrame(animationRef.current);
    const aside = asideRef.current;
    if (aside) { aside.style.width = ""; aside.style.transform = ""; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const sb = document.querySelector<HTMLElement>(".sidebar");
    if (!sb) return;
    const DUR = 220;
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
      if (p < 1) animationRef.current = requestAnimationFrame(tick);
      else {
        // 落位：清除内联，交给样式表（折叠 84 / 展开 264，均无位移）
        sb.style.width = "";
        sb.style.transform = "";
      }
    };
    animationRef.current = requestAnimationFrame(tick);
  };

  const onToggle = () => {
    animateSidebar(!sidebarCollapsed);
    toggleSidebar();
  };

  return (
    <aside className="sidebar" id="site-nav" ref={asideRef} onDragStart={(event) => event.preventDefault()}>
      <div className="brand">
        <Link className="brand-home" to="/welcome" title="返回欢迎页" aria-label="研信智评 · 返回工作台" onClick={() => onClose?.()}>
          <div className="brand-mark" aria-hidden="true">研</div>
          <div className="brand-text">
            <div className="brand-name">研信智评</div>
            <div className="brand-sub">科研诚信智能评审</div>
          </div>
        </Link>
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
        {nav.map(({ path, title, icon: Icon, component }) => {
          const preload = () => {
            void component.preload().catch(() => {
              // 点击或聚焦时由 Suspense/ErrorBoundary 再次尝试并呈现真实错误。
            });
          };
          return (
            <NavLink
              key={path}
              to={path}
              draggable={false}
              title={sidebarCollapsed ? title : undefined}
              onPointerEnter={preload}
              onPointerDown={preload}
              onFocus={preload}
              onTouchStart={preload}
              onClick={() => {
                preload();
                onClose?.();
              }}
              aria-current={path === workspacePath ? "page" : undefined}
              className={() => `nav-item ${path === workspacePath ? "active" : ""}`}
            >
              {path === workspacePath && (
                <motion.span
                  layoutId="nav-pill"
                  className="nav-pill"
                  transition={SPRING}
                />
              )}
              <Icon size={19} className="nav-icon" />
              <span className="nav-label">{title}</span>
            </NavLink>
          );
        })}
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
