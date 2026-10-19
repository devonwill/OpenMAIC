/**
 * 本文件：幻灯片图表元素的渲染组件（编辑态）。
 * 职责：定位、旋转图表容器，叠加边框描边并渲染 ECharts 图表，
 *       处理点选与锁定状态。
 * 关键点：容器尺寸随元素变化，Chart 内部负责按宽高 resize 实例。
 */
'use client';

import type { PPTChartElement } from '@openmaic/dsl';
import { ElementOutline } from '../ElementOutline';
import { Chart } from './Chart';

export { BaseChartElement } from './BaseChartElement';

export interface ChartElementProps {
  elementInfo: PPTChartElement;
  selectElement?: (e: React.MouseEvent | React.TouchEvent, element: PPTChartElement) => void;
}

/**
 * Chart element component
 * Renders interactive charts using ECharts
 * 中文：编辑态图表组件；点选冒泡到白板，锁定时不触发。
 */
export function ChartElement({ elementInfo, selectElement }: ChartElementProps) {
  const handleSelectElement = (e: React.MouseEvent | React.TouchEvent) => {
    if (elementInfo.lock) return;
    e.stopPropagation();
    selectElement?.(e, elementInfo);
  };

  return (
    <div
      className={`editable-element-chart absolute ${elementInfo.lock ? 'lock' : ''}`}
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
          className={`element-content relative w-full h-full overflow-hidden ${
            elementInfo.lock ? 'cursor-default' : 'cursor-move'
          }`}
          style={{
            backgroundColor: elementInfo.fill,
          }}
          onMouseDown={handleSelectElement}
          onTouchStart={handleSelectElement}
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
