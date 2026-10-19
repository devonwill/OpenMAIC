/**
 * 本文件：ECharts 图表的挂载与更新组件。
 * 职责：初始化 SVG 渲染的 ECharts 实例，监听容器尺寸变化自动
 *       resize，并在数据/样式 props 变化时刷新 option。
 * 关键点：主题色不足 10 个时用 tinycolor 生成相近色补足；
 *       实例仅初始化一次（init-only effect），更新走 setOption。
 */
'use client';

import { useEffect, useRef, useMemo } from 'react';
import tinycolor from 'tinycolor2';
import type { ChartData, ChartOptions, ChartType } from '@openmaic/dsl';
import { getChartOption } from './chartOption';

import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart, RadarChart } from 'echarts/charts';
import { LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  LegendComponent,
  SVGRenderer,
]);

interface ChartProps {
  width: number;
  height: number;
  type: ChartType;
  data: ChartData;
  themeColors: string[];
  textColor?: string;
  lineColor?: string;
  options?: ChartOptions;
}

/**
 * 图表容器组件：持有 ECharts 实例，外部只传数据与样式。
 * 用 SVG 渲染器便于导出/缩放时保持矢量清晰。
 */
export function Chart({
  width: _width,
  height: _height,
  type,
  data,
  themeColors: rawThemeColors,
  textColor,
  lineColor,
  options,
}: ChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  // Generate theme colors
  // 配色需恒为 10 色：>=10 直接用；只有 1 色时生成 10 个相近色；
  // 多色时保留前 len-1 个、从末色扩展补足，保证多序列颜色稳定不跳变
  const themeColors = useMemo(() => {
    let colors: string[] = [];
    if (rawThemeColors.length >= 10) {
      colors = rawThemeColors;
    } else if (rawThemeColors.length === 1) {
      colors = tinycolor(rawThemeColors[0])
        .analogous(10)
        .map((color) => color.toRgbString());
    } else {
      const len = rawThemeColors.length;
      const supplement = tinycolor(rawThemeColors[len - 1])
        .analogous(10 + 1 - len)
        .map((color) => color.toRgbString());
      colors = [...rawThemeColors.slice(0, len - 1), ...supplement];
    }
    return colors;
  }, [rawThemeColors]);

  // Update chart option
  const updateOption = useMemo(() => {
    return () => {
      if (!chartInstance.current) return;

      const option = getChartOption({
        type,
        data,
        themeColors,
        textColor,
        lineColor,
        lineSmooth: options?.lineSmooth || false,
        stack: options?.stack || false,
      });

      if (option) {
        chartInstance.current.setOption(option, true);
      }
    };
  }, [type, data, themeColors, textColor, lineColor, options]);

  // Initialize chart
  useEffect(() => {
    if (!chartRef.current) return;

    chartInstance.current = echarts.init(chartRef.current, null, {
      renderer: 'svg',
    });
    updateOption();

    const resizeObserver = new ResizeObserver(() => {
      chartInstance.current?.resize();
    });
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Init-only effect: chart setup and resize observer
  }, []);

  // Update chart when props change
  useEffect(() => {
    updateOption();
  }, [updateOption]);

  return <div ref={chartRef} className="chart w-full h-full" />;
}
