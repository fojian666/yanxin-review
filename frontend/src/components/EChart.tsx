import * as echarts from "echarts";
import "echarts-gl";
import { useEffect, useRef } from "react";

interface EChartProps {
  option: Record<string, unknown>;
  height?: number;
  className?: string;
  disableWheelZoom?: boolean;
}

export function EChart({ option, height = 360, className = "", disableWheelZoom = false }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => {
      // 容器尺寸变化时图表平滑形变而非跳变
      chart.resize({ animation: { duration: 350, easing: "cubicOut" } } as never);
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option as echarts.EChartsOption, {
      notMerge: false,
      replaceMerge: ["series"],
      lazyUpdate: false,
    });
  }, [option]);

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

  return <div ref={containerRef} className={className} style={{ height }} />;
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
