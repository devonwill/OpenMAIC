/**
 * 本文件：图片椭圆描边组件。
 * 职责：按元素宽高绘制内切 SVG 椭圆描边，无描边配置时不渲染。
 * 关键点：non-scaling-stroke 保证缩放时线宽恒定。
 */
'use client';

import type { PPTElementOutline } from '@openmaic/dsl';
import { useElementOutline } from '../../hooks/useElementOutline';

export interface ImageEllipseOutlineProps {
  width: number;
  height: number;
  outline?: PPTElementOutline;
}

/**
 * Ellipse outline for image element
 */
export function ImageEllipseOutline({ width, height, outline }: ImageEllipseOutlineProps) {
  const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(outline);

  if (!outline) return null;

  return (
    <svg className="absolute top-0 left-0 z-[2] overflow-visible" width={width} height={height}>
      <ellipse
        vectorEffect="non-scaling-stroke"
        strokeLinecap="butt"
        strokeMiterlimit="8"
        fill="transparent"
        cx={width / 2}
        cy={height / 2}
        rx={width / 2}
        ry={height / 2}
        stroke={outlineColor}
        strokeWidth={outlineWidth}
        strokeDasharray={strokeDashArray}
      />
    </svg>
  );
}
