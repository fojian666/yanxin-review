import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCallback,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useMotionPreference } from "../motion";

export interface WorkDeckStep<T extends string = string> {
  id: T;
  label: string;
  hint: string;
}

export function InlinePager({
  label,
  index,
  total,
  onChange,
}: {
  label: string;
  index: number;
  total: number;
  onChange: (index: number) => void;
}) {
  if (total < 2) return null;
  return (
    <div className="inline-pager" role="group" aria-label={`${label}分页`}>
      <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => onChange(index - 1)}>
        <ChevronLeft size={14} />上一页
      </button>
      <span>{index + 1} / {total}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={index >= total - 1} onClick={() => onChange(index + 1)}>
        下一页<ChevronRight size={14} />
      </button>
    </div>
  );
}

interface WorkDeckProps<T extends string> {
  id?: string;
  hidden?: boolean;
  steps: ReadonlyArray<WorkDeckStep<T>>;
  active: T;
  onChange: (step: T) => void;
  panels: Record<T, ReactNode>;
  ariaLabel: string;
  status?: ReactNode;
  compactStatus?: boolean;
  className?: string;
}

const panelVariants = {
  enter: (direction: number) => ({
    x: direction >= 0 ? 14 : -14,
    opacity: 1,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction >= 0 ? -8 : 8,
    opacity: 0,
    pointerEvents: "none" as const,
  }),
};

export function WorkDeck<T extends string>({
  id,
  hidden = false,
  steps,
  active,
  onChange,
  panels,
  ariaLabel,
  status,
  compactStatus = false,
  className = "",
}: WorkDeckProps<T>) {
  const reduce = useMotionPreference();
  const baseId = useId().replace(/:/g, "");
  const [direction, setDirection] = useState(1);
  const rawIndex = steps.findIndex((step) => step.id === active);
  const activeIndex = rawIndex < 0 ? 0 : rawIndex;
  const current = steps[activeIndex];

  const select = useCallback((next: T, index: number) => {
    if (next === active) return;
    setDirection(index >= activeIndex ? 1 : -1);
    onChange(next);
  }, [active, activeIndex, onChange]);

  const onRailKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const focusedTab = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    const focusedIndex = Number(focusedTab?.dataset.stepIndex ?? activeIndex);
    const originIndex = Number.isInteger(focusedIndex) ? focusedIndex : activeIndex;
    const targetIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? steps.length - 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? Math.max(0, originIndex - 1)
          : Math.min(steps.length - 1, originIndex + 1);
    const next = steps[targetIndex];
    if (!next) return;
    select(next.id, targetIndex);
    requestAnimationFrame(() => {
      document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
    });
  };

  const changeRelative = (offset: number) => {
    const nextIndex = Math.max(0, Math.min(steps.length - 1, activeIndex + offset));
    const next = steps[nextIndex];
    if (next) select(next.id, nextIndex);
  };

  return (
    <section id={id} className={`work-deck ${compactStatus && status ? "has-compact-status" : ""} ${className}`.trim()} aria-label={ariaLabel} hidden={hidden}>
      <aside className="work-deck-rail">
        <div className="work-deck-rail-head">
          <span>{ariaLabel}</span>
          <strong>{String(activeIndex + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</strong>
        </div>
        <nav role="tablist" aria-label={ariaLabel} onKeyDown={onRailKeyDown}>
          {steps.map((step, index) => {
            const selected = step.id === active;
            return (
              <button
                type="button"
                id={`${baseId}-tab-${step.id}`}
                key={step.id}
                role="tab"
                data-step-index={index}
                aria-label={step.label}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                className={selected ? "is-active" : ""}
                onClick={() => select(step.id, index)}
              >
                {selected && (
                  <motion.span
                    className="work-deck-active"
                    layoutId={`${baseId}-active`}
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 430, damping: 38, mass: 0.7 }}
                  />
                )}
                <span className="work-deck-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="work-deck-copy">
                  <strong>{step.label}</strong>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="work-deck-main">
        <header className="work-deck-head">
          <span>第 {activeIndex + 1} 步</span>
          <div>
            <h3>{current.label}</h3>
          </div>
          {status}
        </header>

        <div
          id={`${baseId}-panel`}
          className="work-deck-body"
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${current.id}`}
        >
          <AnimatePresence initial={false} custom={direction} mode="sync">
            <motion.div
              key={active}
              className="work-deck-panel"
              data-direction={direction >= 0 ? "next" : "prev"}
              custom={direction}
              variants={panelVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={reduce
                ? { duration: 0 }
                : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {panels[active]}
            </motion.div>
          </AnimatePresence>
        </div>

        <footer className="work-deck-footer">
          <button type="button" className="btn btn-ghost btn-sm" disabled={activeIndex === 0} onClick={() => changeRelative(-1)}>
            <ChevronLeft size={15} />上一步
          </button>
          <span aria-live="polite">{activeIndex + 1} / {steps.length} · {current.label}</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={activeIndex >= steps.length - 1} onClick={() => changeRelative(1)}>
            下一步<ChevronRight size={15} />
          </button>
          {compactStatus && <div className="work-deck-compact-status">{status}</div>}
        </footer>
      </div>
    </section>
  );
}
