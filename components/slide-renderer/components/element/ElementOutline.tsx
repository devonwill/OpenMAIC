/**
 * 本文件：元素描边（边框）叠加层组件。
 * 职责：在元素绝对定位盒上覆盖一层 SVG 矩形路径，绘制实线/虚线/点线边框。
 * 关键点：使用 non-scaling-stroke，元素缩放时线宽不被 transform 放大。
 */
'use client';

import type { PPTElementOutline } from '@openmaic/dsl';
import { useElementOutline } from './hooks/useElementOutline';

export interface ElementOutlineProps {
  width: number;
  height: number;
  outline?: PPTElementOutline;
}

/**
 * Element outline (border) component
 * Renders an SVG outline around an element based on outline configuration
 *
 * 中文：无描边配置时返回 null，不渲染任何 DOM。
 */
export function ElementOutline({ width, height, outline }: ElementOutlineProps) {
  const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(outline);

  if (!outline) return null;

  return (
    <svg
      className="element-outline absolute top-0 left-0 overflow-visible"
      width={width}
      height={height}
    >
      <path
        vectorEffect="non-scaling-stroke"
        strokeLinecap="butt"
        strokeMiterlimit="8"
        fill="transparent"
        d={`M0,0 L${width},0 L${width},${height} L0,${height} Z`}
        stroke={outlineColor}
        strokeWidth={outlineWidth}
        strokeDasharray={strokeDashArray}
      />
    </svg>
  );
}
