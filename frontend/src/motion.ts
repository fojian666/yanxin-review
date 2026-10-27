import type { Transition, Variants } from "framer-motion";
import { useEffect, useState, useSyncExternalStore } from "react";

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const SPRING: Transition = { type: "spring", stiffness: 330, damping: 30, mass: 0.9 };
export const MOTION = { feedback: 0.15, enter: 0.22, exit: 0.1, number: 480 } as const;

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: MOTION.enter, ease: EASE } },
  exit: { opacity: 0, transition: { duration: 0.06, ease: EASE } },
};

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.025, delayChildren: 0 },
  },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0, transition: { duration: MOTION.enter, ease: EASE } },
};

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribeMotionPreference(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Canvas 与 rAF 不受 CSS 媒体查询控制，也要即时响应系统设置变化。
export function useMotionPreference(): boolean {
  return useSyncExternalStore(subscribeMotionPreference, prefersReducedMotion, () => false);
}

// 仅控制装饰入场；会话存储不可用时仍正常展示内容。
export function useSessionEntrance(key: string): boolean {
  const [play] = useState(() => {
    try { return sessionStorage.getItem(key) !== "seen"; } catch { return true; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(key, "seen"); } catch { /* 无存储时不阻断页面 */ }
  }, [key]);
  return play;
}
