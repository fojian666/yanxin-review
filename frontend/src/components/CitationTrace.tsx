import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { EASE, useMotionPreference } from "../motion";

export interface CitationSelection {
  index: number;
  id: number;
  origin: HTMLElement;
}

type Point = { x: number; y: number };

// 仅在桌面两栏同时可见时画线；原有证据定位独立运行，装饰不接管焦点。
export function CitationTrace({ selection }: { selection: CitationSelection | null }) {
  const reduce = useMotionPreference();
  const [trace, setTrace] = useState<{ id: number; points: Point[] } | null>(null);
  useEffect(() => {
    setTrace(null);
    if (!selection || reduce) return;
    let timer = 0;
    let frame = 0;
    const clear = () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      setTrace(null);
    };
    frame = requestAnimationFrame(() => {
      const target = document.getElementById(`source-${selection.index}`);
      const panel = target?.closest(".sources-panel");
      const chat = selection.origin.closest(".chat-panel");
      if (!target || !panel || !chat || !selection.origin.isConnected) return;
      const from = selection.origin.getBoundingClientRect();
      const to = target.querySelector(".source-index")?.getBoundingClientRect();
      const left = chat.getBoundingClientRect();
      const right = panel.getBoundingClientRect();
      const visible = (r: DOMRect) => r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      // 叠为单栏、端点不在视口或位于内部滚动区裁切处时，仅保留原文强调。
      const messageArea = selection.origin.closest(".chat-messages")?.getBoundingClientRect();
      const sourceArea = target.closest(".sources")?.getBoundingClientRect();
      if (!to || !visible(from) || !visible(to) || right.left < left.right
        || !messageArea || from.top < messageArea.top || from.bottom > messageArea.bottom
        || !sourceArea || to.top < sourceArea.top || to.bottom > sourceArea.bottom) return;
      const gutter = (left.right + right.left) / 2;
      setTrace({ id: selection.id, points: [
        { x: from.right + 3, y: from.top + from.height / 2 },
        { x: gutter, y: from.top + from.height / 2 },
        { x: gutter, y: to.top + to.height / 2 },
        { x: to.left - 3, y: to.top + to.height / 2 },
      ] });
      timer = window.setTimeout(clear, 700);
    });
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, [selection, reduce]);

  if (!trace || reduce) return null;
  return (
    <motion.div className="citation-trace" key={trace.id} aria-hidden="true"
      initial={{ opacity: 0 }} animate={{ opacity: [0, 0.8, 0.8, 0] }}
      transition={{ duration: 0.65, times: [0, 0.1, 0.7, 1] }}>
      {trace.points.slice(0, -1).map((point, index) => {
        const next = trace.points[index + 1];
        return <span className="citation-trace-segment" key={index} style={{
          left: point.x, top: point.y,
          width: Math.hypot(next.x - point.x, next.y - point.y),
          transform: `rotate(${Math.atan2(next.y - point.y, next.x - point.x)}rad)`,
        }}><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
          transition={{ duration: 0.18, delay: index * 0.12, ease: EASE }} /></span>;
      })}
      <motion.b className="citation-trace-point"
        animate={{ x: trace.points.map(p => p.x), y: trace.points.map(p => p.y) }}
        transition={{ duration: 0.48, ease: "linear" }} />
    </motion.div>
  );
}
