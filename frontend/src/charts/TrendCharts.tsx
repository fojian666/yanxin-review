import * as echarts from "echarts";
import { useMemo } from "react";
import { EChart } from "../components/EChart";
import { escapeHtml } from "../components/Markdown";
import { prefersReducedMotion } from "../motion";
import type { TrendData } from "../types";

const COLORS = ["#22b8a0", "#d6a75c", "#5b9bd5", "#d47b72", "#9bbf6a", "#b08ad4"];
const AXIS = "#a9c3bc";
const GRID = "rgba(255,255,255,.075)";
const AXIS_LINE = "#31514b";

export function AnnualChart3D({ data }: { data: TrendData }) {
  const option = useMemo(() => {
    const counts = data.counts ?? [];
    const years = data.years ?? [];
    const maxCount = Math.max(1, ...counts);
    const reduce = prefersReducedMotion();
    return {
      backgroundColor: "transparent",
      animation: !reduce,
      animationDuration: reduce ? 0 : 1150,
      animationDurationUpdate: 800,
      animationEasingUpdate: "cubicOut",
      tooltip: {
        backgroundColor: "rgba(7,24,30,.94)",
        borderColor: "#2d5b52",
        textStyle: { color: "#e9f2ef", fontSize: 12 },
        formatter: (params: { value: [number, number, number] }) => {
          const [xi, , value] = params.value;
          return `${years[xi]} 年：<b>${value}</b> 篇`;
        },
      },
      visualMap: {
        show: false,
        dimension: 2,
        min: 0,
        max: maxCount,
        inRange: { color: ["#17574f", "#18a08a", "#8ff3dd"] },
      },
      xAxis3D: {
        type: "category",
        data: years.map(String),
        axisLabel: {
          color: AXIS,
          fontSize: 10,
          interval: 0,
          formatter: (value: string) => value.slice(2),
        },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        axisTick: { show: false },
      },
      yAxis3D: { type: "category", data: [""], show: false },
      zAxis3D: {
        type: "value",
        name: "篇",
        nameTextStyle: { color: "#7f9d96", fontSize: 10 },
        axisLabel: { color: AXIS, fontSize: 10 },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        splitLine: { lineStyle: { color: GRID } },
      },
      grid3D: {
        boxWidth: 134,
        boxDepth: 38,
        boxHeight: 78,
        viewControl: {
          autoRotate: !reduce,
          autoRotateSpeed: 3.2,
          autoRotateAfterStill: 4,
          distance: 172,
          alpha: 18,
          beta: 30,
          minDistance: 100,
          maxDistance: 280,
          rotateSensitivity: 1.2,
          zoomSensitivity: 0,
        },
        light: {
          main: { intensity: 1.45, shadow: true, alpha: 35, beta: 40 },
          ambient: { intensity: 0.5 },
        },
        postEffect: {
          enable: true,
          bloom: { enable: true, bloomIntensity: 0.12 },
          SSAO: { enable: true, radius: 2, intensity: 1.0 },
        },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        splitLine: { lineStyle: { color: GRID } },
        environment: "transparent",
      },
      series: [
        {
          type: "bar3D",
          data: years.map((_, index) => [index, 0, counts[index] ?? 0]),
          shading: "lambert",
          barSize: 1.0,
          bevelSize: 0.2,
          bevelSmoothness: 3,
          itemStyle: { opacity: 0.96 },
          emphasis: { itemStyle: { color: "#f3c877" } },
          animationDuration: reduce ? 0 : 1400,
          animationEasing: "cubicOut",
        },
      ],
    };
  }, [data]);

  return <EChart option={option} className="chart-3d" height={345} disableWheelZoom />;
}

export function TopicMatrix3D({ data }: { data: TrendData }) {
  const option = useMemo(() => {
    const series = (data.keyword_series ?? []).slice(0, 4);
    const years = data.years ?? [];
    const keywords = series.map((s) => s.name);
    const cells: [number, number, number][] = [];
    let maxCount = 1;
    const reduce = prefersReducedMotion();
    series.forEach((s, yi) => {
      s.values.forEach((value, xi) => {
        if (value > 0) {
          cells.push([xi, yi, value]);
          maxCount = Math.max(maxCount, value);
        }
      });
    });
    return {
      backgroundColor: "transparent",
      animation: !reduce,
      animationDuration: reduce ? 0 : 1150,
      animationDurationUpdate: 800,
      animationEasingUpdate: "cubicOut",
      tooltip: {
        backgroundColor: "rgba(7,24,30,.94)",
        borderColor: "#2d5b52",
        textStyle: { color: "#e9f2ef", fontSize: 12 },
        formatter: (params: { value: [number, number, number] }) => {
          const [xi, yi, value] = params.value;
          // 关键词来自用户导入的 CSV，ECharts tooltip 按 HTML 渲染，必须转义
          return `${escapeHtml(keywords[yi] ?? "")} · ${years[xi]} 年：<b>${value}</b> 篇`;
        },
      },
      visualMap: {
        show: false,
        dimension: 2,
        min: 0,
        max: maxCount,
        inRange: { color: ["#15524b", "#18a08a", "#f3c877"] },
      },
      xAxis3D: {
        type: "category",
        data: years.map(String),
        axisLabel: {
          color: AXIS,
          fontSize: 10,
          interval: 0,
          formatter: (value: string) => value.slice(2),
        },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        axisTick: { show: false },
      },
      yAxis3D: {
        type: "category",
        data: keywords,
        axisLabel: {
          color: AXIS,
          fontSize: 9,
          interval: 0,
          formatter: (value: string) => (value.length > 6 ? `${value.slice(0, 6)}…` : value),
        },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        axisTick: { show: false },
      },
      zAxis3D: {
        type: "value",
        name: "篇",
        nameTextStyle: { color: "#7f9d96", fontSize: 10 },
        axisLabel: { color: AXIS, fontSize: 10 },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        splitLine: { lineStyle: { color: GRID } },
      },
      grid3D: {
        boxWidth: 112,
        boxDepth: 62,
        boxHeight: 64,
        viewControl: {
          autoRotate: !reduce,
          autoRotateSpeed: 3.6,
          autoRotateAfterStill: 4,
          distance: 188,
          alpha: 20,
          beta: 35,
          minDistance: 115,
          maxDistance: 300,
          zoomSensitivity: 0,
        },
        light: {
          main: { intensity: 1.35, shadow: true, alpha: 35, beta: 40 },
          ambient: { intensity: 0.52 },
        },
        postEffect: {
          enable: true,
          bloom: { enable: true, bloomIntensity: 0.1 },
          SSAO: { enable: true, radius: 2, intensity: 1.0 },
        },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        splitLine: { lineStyle: { color: GRID } },
        environment: "transparent",
      },
      series: [
        {
          type: "bar3D",
          data: cells,
          shading: "lambert",
          barSize: 0.52,
          bevelSize: 0.15,
          bevelSmoothness: 3,
          itemStyle: { opacity: 0.95 },
          emphasis: { itemStyle: { color: "#ffffff" } },
          animationDuration: reduce ? 0 : 1500,
          animationEasing: "cubicOut",
        },
      ],
    };
  }, [data]);

  return <EChart option={option} className="chart-3d" height={345} disableWheelZoom />;
}

export function TrendLine2D({ data }: { data: TrendData }) {
  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      color: COLORS,
      animationDuration: 900,
      animationDurationUpdate: 650,
      animationEasingUpdate: "cubicOut",
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(7,24,30,.94)",
        borderColor: "#2d5b52",
        textStyle: { color: "#e9f2ef", fontSize: 12 },
      },
      legend: {
        top: 0,
        textStyle: { color: AXIS, fontSize: 11 },
        itemWidth: 10,
        itemHeight: 6,
      },
      grid: { left: 42, right: 18, top: 42, bottom: 30 },
      xAxis: {
        type: "category",
        data: data.years.map(String),
        axisLabel: { color: AXIS, fontSize: 10 },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: AXIS, fontSize: 10 },
        splitLine: { lineStyle: { color: GRID } },
        axisLine: { show: false },
      },
      series: data.keyword_series.map((s) => ({
        name: s.name,
        type: "line",
        smooth: true,
        symbolSize: 6,
        data: s.values,
        lineStyle: { width: 2.4 },
        areaStyle: { opacity: 0.06 },
        emphasis: { focus: "series" },
      })),
    }),
    [data]
  );
  return <EChart option={option} className="chart-2d" height={345} />;
}

export function TrendBar2D({ data }: { data: TrendData }) {
  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      animationDuration: 900,
      animationDurationUpdate: 650,
      animationEasingUpdate: "cubicOut",
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(7,24,30,.94)",
        borderColor: "#2d5b52",
        textStyle: { color: "#e9f2ef", fontSize: 12 },
      },
      grid: { left: 38, right: 16, top: 28, bottom: 30 },
      xAxis: {
        type: "category",
        data: data.years.map(String),
        axisLabel: { color: AXIS, fontSize: 10 },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: AXIS, fontSize: 10 },
        splitLine: { lineStyle: { color: GRID } },
        axisLine: { show: false },
      },
      series: [
        {
          type: "bar",
          data: data.counts,
          barWidth: "46%",
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#68e0c8" },
              { offset: 1, color: "#0e7c6b" },
            ]),
          },
          label: {
            show: true,
            position: "top",
            color: "#cfe6df",
            fontSize: 10,
          },
          emphasis: {
            itemStyle: { color: "#f3c877" },
          },
        },
      ],
    }),
    [data]
  );
  return <EChart option={option} className="chart-2d" height={345} />;
}
