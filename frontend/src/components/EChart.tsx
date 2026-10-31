import * as echarts from "echarts";
import "echarts-gl";
import { useEffect, useRef, useState } from "react";
import { useMotionPreference } from "../motion";

interface EChartProps {
  option: Record<string, unknown>;
  height?: number | string;
  className?: string;
  disableWheelZoom?: boolean;
  ariaLabel?: string;
  autoRotate?: boolean;
  onClick?: (params: unknown) => void;
}

export function EChart({ option, height = 360, className = "", disableWheelZoom = false, ariaLabel, autoRotate, onClick }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  const reduce = useMotionPreference();
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const moving = inView && pageVisible && !reduce;

  useEffect(() => {
    clickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    chart.on("click", (params) => clickRef.current?.(params));
    let resizeFrame = 0;
    let width = 0;
    let height = 0;
    const observer = new ResizeObserver(() => {
      const nextWidth = containerRef.current?.clientWidth ?? 0;
      const nextHeight = containerRef.current?.clientHeight ?? 0;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      // 合并同一布局帧内的多次观察，极端缩放时避免图表反复同步重绘。
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => chart.resize({ animation: { duration: 0 } } as never));
    });
    observer.observe(containerRef.current);
    const visibility = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    visibility.observe(containerRef.current);
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    // 禁用库内不可取消的恢复计时器，拖拽结束后由组件管理 4 秒静置恢复。
    setInteractionPaused(false);
    if (!el || !moving || !autoRotate) return;
    let timer = 0;
    let pressed = false;
    const onDown = () => {
      pressed = true;
      window.clearTimeout(timer);
      setInteractionPaused(true);
    };
    const onUp = () => {
      if (!pressed) return;
      pressed = false;
      timer = window.setTimeout(() => setInteractionPaused(false), 4000);
    };
    el.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [moving, autoRotate]);

  useEffect(() => {
    chartRef.current?.setOption(option as echarts.EChartsOption, {
      notMerge: false,
      replaceMerge: ["series"],
      lazyUpdate: false,
    });
  }, [option]);

  useEffect(() => {
    // 单独更新运动开关，保留用户拖拽后的视角，不重建数据或图表实例。
    chartRef.current?.setOption({
      animation: moving,
      ...(autoRotate !== undefined ? { grid3D: { viewControl: { autoRotate: moving && autoRotate && !interactionPaused } } } : {}),
    } as echarts.EChartsOption);
  }, [option, moving, autoRotate, interactionPaused]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !disableWheelZoom) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      // Keep ordinary wheel gestures for page scrolling instead of chart zoom.
      event.preventDefault();
      event.stopPropagation();
      const factor =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1;
      window.scrollBy(0, event.deltaY * factor);
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [disableWheelZoom]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height }}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      data-motion={reduce ? "reduced" : !inView || !pageVisible ? "offscreen" : autoRotate === false ? "paused" : "active"}
    />
  );
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}
