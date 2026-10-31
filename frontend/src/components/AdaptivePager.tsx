import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { InlinePager } from "./WorkDeck";

type PageRange = readonly [start: number, end: number];

export function computeAdaptivePages(heights: readonly number[], available: number, gap: number): PageRange[] {
  if (heights.length === 0) return [];
  const limit = Math.max(0, available);
  const spacing = Math.max(0, gap);
  const pages: PageRange[] = [];
  let start = 0;
  let used = 0;
  heights.forEach((height, index) => {
    const itemHeight = Math.max(0, height);
    const nextHeight = used + (index > start ? spacing : 0) + itemHeight;
    if (index > start && nextHeight > limit) {
      pages.push([start, index]);
      start = index;
      used = itemHeight;
    } else {
      used = nextHeight;
    }
  });
  pages.push([start, heights.length]);
  return pages;
}

function samePages(left: readonly PageRange[], right: readonly PageRange[]): boolean {
  return left.length === right.length
    && left.every((range, index) => range[0] === right[index]?.[0] && range[1] === right[index]?.[1]);
}

export function AdaptivePager<T>({
  label,
  items,
  renderItem,
  getKey,
  resetKey,
  fill = true,
  className = "",
}: {
  label: string;
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  resetKey?: string;
  fill?: boolean;
  className?: string;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pages, setPages] = useState<PageRange[]>(() => [[0, items.length]]);
  const [measurement, setMeasurement] = useState({ available: 0, heights: [] as number[] });

  const remeasure = useCallback(() => {
    const page = pageRef.current;
    const measure = measureRef.current;
    if (!page || !measure) return;
    const measuredItems = Array.from(measure.children) as HTMLElement[];
    const heights = measuredItems.map(element => element.getBoundingClientRect().height);
    const gap = Number.parseFloat(getComputedStyle(page).rowGap) || 0;
    const available = page.clientHeight;
    const next = computeAdaptivePages(heights, available, gap);
    setMeasurement(current => (
      current.available === available
      && current.heights.length === heights.length
      && current.heights.every((height, index) => Math.abs(height - heights[index]) < .5)
    ) ? current : { available, heights });
    setPages(current => samePages(current, next) ? current : next);
  }, []);

  useEffect(() => {
    setPageIndex(0);
  }, [resetKey, items.length]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    const measure = measureRef.current;
    if (!page || !measure) return;
    remeasure();
    const observer = new ResizeObserver(remeasure);
    observer.observe(page);
    window.addEventListener("resize", remeasure);
    void document.fonts?.ready.then(remeasure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", remeasure);
    };
  }, [items.length, remeasure, resetKey]);

  const safePage = Math.min(pageIndex, Math.max(0, pages.length - 1));
  useEffect(() => {
    if (pageRef.current) pageRef.current.scrollTop = 0;
  }, [safePage]);

  if (items.length === 0) return null;
  const [start, end] = pages[safePage] ?? [0, items.length];
  const visible = items.slice(start, end);

  return (
    <div
      className={`adaptive-pager ${fill ? "is-fill" : ""} ${className}`.trim()}
      data-adaptive-pager={label}
      data-page-index={safePage}
      data-page-count={pages.length}
      data-visible-count={visible.length}
      data-available-height={measurement.available}
      data-measured-heights={measurement.heights.join(",")}
    >
      <div className="adaptive-pager-page" ref={pageRef}>
        {visible.map((item, visibleIndex) => {
          const index = start + visibleIndex;
          return (
            <div className="adaptive-pager-item" key={getKey(item, index)}>
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
      <div className="adaptive-pager-measure" ref={measureRef} aria-hidden="true">
        {items.map((item, index) => (
          <div className="adaptive-pager-item" key={`measure:${getKey(item, index)}`}>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
      <InlinePager
        label={label}
        index={safePage}
        total={pages.length}
        onChange={next => setPageIndex(Math.max(0, Math.min(pages.length - 1, next)))}
      />
    </div>
  );
}
