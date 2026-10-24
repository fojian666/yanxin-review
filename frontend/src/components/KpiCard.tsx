import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { EASE } from "../motion";

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    const duration = 1050;
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  const rounded = Math.round(display);
  return (
    <span>
      {rounded}
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
}

export function KpiCard({ label, value, suffix, sub, tone = "ink", delay = 0 }: KpiCardProps) {
  return (
    <motion.div
      className={`kpi kpi-${tone}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, transition: { duration: 0.21, ease: EASE, delay: 0 } }}
      transition={{ duration: 0.45, ease: EASE, delay }}
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {typeof value === "number" ? (
          <AnimatedNumber value={value} suffix={suffix} />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={String(value)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.23, ease: EASE }}
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
            transition={{ duration: 0.21, ease: EASE }}
          >
            {sub}
          </motion.div>
        </AnimatePresence>
      )}
    </motion.div>
  );
}
