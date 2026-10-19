/**
 * 本文件：幻灯片图表元素的渲染组件（只读/回放/缩略图态）。
 * 职责：定位、旋转容器，叠加填充与描边并渲染 ECharts 图表，不可交互。
 * 关键点：target 为 thumbnail 时关闭 pointer-events；
 *       图表配置与编辑态同源（chartOption），保证导出视觉一致。
 */
'use client';

import type { PPTChartElement } from '@openmaic/dsl';
import { ElementOutline } from '../ElementOutline';
import { Chart } from './Chart';

export interface BaseChartElementProps {
  elementInfo: PPTChartElement;
  target?: string;
}

/**
 * Base chart element for read-only/playback mode
 * 中文：只读态图表组件；缩略图场景禁用指针事件。
 */
export function BaseChartElement({ elementInfo, target }: BaseChartElementProps) {
  return (
    <div
      className={`base-element-chart absolute ${target === 'thumbnail' ? 'pointer-events-none' : ''}`}
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
      }}
    >
      <div
        className="rotate-wrapper w-full h-full"
        style={{ transform: `rotate(${elementInfo.rotate}deg)` }}
      >
        <div
          className="element-content w-full h-full"
          style={{
            backgroundColor: elementInfo.fill,
          }}
        >
          <ElementOutline
            width={elementInfo.width}
            height={elementInfo.height}
            outline={elementInfo.outline}
          />
          <Chart
            width={elementInfo.width}
            height={elementInfo.height}
            type={elementInfo.chartType}
            data={elementInfo.data}
            themeColors={elementInfo.themeColors}
            textColor={elementInfo.textColor}
            lineColor={elementInfo.lineColor}
            options={elementInfo.options}
          />
        </div>
      </div>
    </div>
  );
}
