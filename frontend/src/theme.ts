import { useSyncExternalStore } from "react";

export type Theme = "paper" | "mono" | "blue" | "aurora";
export const themes: ReadonlyArray<{ id: Theme; label: string }> = [
  { id: "paper", label: "青绿纸色" },
  { id: "mono", label: "黑白" },
  { id: "blue", label: "蓝白" },
  { id: "aurora", label: "极光紫" },
];

function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem("yanxin.theme");
    if (saved === "paper" || saved === "mono" || saved === "blue" || saved === "aurora") return saved;
  } catch { /* 本地存储不可用时使用默认主题 */ }
  return "blue";
}

let current: Theme = savedTheme();
const listeners = new Set<() => void>();
document.documentElement.dataset.theme = current;
window.addEventListener("storage", event => {
  if (event.key !== "yanxin.theme") return;
  const next = savedTheme();
  if (next === current) return;
  current = next;
  document.documentElement.dataset.theme = next;
  listeners.forEach(listener => listener());
});

export function setTheme(theme: Theme) {
  if (current === theme) return;
  current = theme;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("yanxin.theme", theme); } catch { /* 不影响本次切换 */ }
  listeners.forEach(listener => listener());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener); },
    () => current,
  );
}
