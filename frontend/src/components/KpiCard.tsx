import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { EASE, MOTION, useMotionPreference } from "../motion";

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const reduce = useMotionPreference();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    if (reduce) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const duration = MOTION.number;
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (value - from) * eased;
      fromRef.current = next;
      setDisplay(next);
      if (p < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduce]);
  const rounded = Math.round(display);
  return (
    <span>
      {reduce ? value : rounded}
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

interface KpiCardProps {
  label: string;
  value: number | string;
  suffix?: string;
  sub?: string;
  tone?: "teal" | "gold" | "ink";
  delay?: number;
  format?: "number" | "range" | "text";
}

export function KpiCard({ label, value, suffix, sub, tone = "ink", delay = 0, format = "number" }: KpiCardProps) {
  const reduce = useMotionPreference();
  const [flash, setFlash] = useState(false);
  const previous = useRef(value);
  useEffect(() => {
    if (reduce) { previous.current = value; setFlash(false); return; }
    if (previous.current === value) return;
    previous.current = value;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 480);
    return () => window.clearTimeout(timer);
  }, [value, reduce]);

  return (
    <motion.div
      className={`kpi kpi-${tone} kpi-format-${format} ${flash ? "kpi-flash" : ""}`}
      initial={reduce ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : MOTION.enter, ease: EASE, delay: reduce ? 0 : delay }}
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" title={String(value)}>
        {typeof value === "number" ? (
          <AnimatedNumber value={value} suffix={suffix} />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={String(value)}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: reduce ? 0 : MOTION.feedback, ease: EASE }}
            >
              {value}
            </motion.span>
          </AnimatePresence>
        )}
      </div>
      {sub && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="kpi-sub"
            key={sub}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : MOTION.feedback, ease: EASE }}
          >
            {sub}
          </motion.div>
        </AnimatePresence>
      )}
    </motion.div>
  );
}
