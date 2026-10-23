import type { Transition, Variants } from "framer-motion";

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const SPRING: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };
export const SOFT_SPRING: Transition = { type: "spring", stiffness: 260, damping: 28, mass: 0.9 };

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: EASE } },
};

export const fadeUp: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15, ease: EASE } },
};

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.045, delayChildren: 0.04 },
  },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } },
};

export const hoverLift = {
  whileHover: { y: -2, transition: { duration: 0.16, ease: EASE } },
  whileTap: { scale: 0.985 },
};

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
