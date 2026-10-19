/**
 * 本文件：图片矩形（可带圆角）描边组件。
 * 职责：按元素宽高与圆角绘制 SVG 矩形描边，无描边配置时不渲染。
 * 关键点：non-scaling-stroke 保证缩放时线宽恒定。
 */
'use client';

import type { PPTElementOutline } from '@openmaic/dsl';
import { useElementOutline } from '../../hooks/useElementOutline';

export interface ImageRectOutlineProps {
  width: number;
  height: number;
  outline?: PPTElementOutline;
  radius?: string;
}

/**
 * Rectangle outline for image element
 */
export function ImageRectOutline({ width, height, outline, radius = '0' }: ImageRectOutlineProps) {
  const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(outline);

  if (!outline) return null;

  return (
    <svg className="absolute top-0 left-0 z-[2] overflow-visible" width={width} height={height}>
      <rect
        vectorEffect="non-scaling-stroke"
        strokeLinecap="butt"
        strokeMiterlimit="8"
        fill="transparent"
        rx={radius}
        ry={radius}
        width={width}
        height={height}
        stroke={outlineColor}
        strokeWidth={outlineWidth}
        strokeDasharray={strokeDashArray}
      />
    </svg>
  );
}
