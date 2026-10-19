/**
 * 本文件：图片多边形描边组件。
 * 职责：用外部传入的 createPath 生成路径并绘制描边，适配任意多边形裁剪。
 * 关键点：路径按当前宽高实时生成，元素缩放后轮廓随之更新。
 */
'use client';

import type { PPTElementOutline } from '@openmaic/dsl';
import { useElementOutline } from '../../hooks/useElementOutline';

export interface ImagePolygonOutlineProps {
  width: number;
  height: number;
  createPath: (width: number, height: number) => string;
  outline?: PPTElementOutline;
}

/**
 * Polygon outline for image element
 */
export function ImagePolygonOutline({
  width,
  height,
  createPath,
  outline,
}: ImagePolygonOutlineProps) {
  const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(outline);

  if (!outline) return null;

  return (
    <svg className="absolute top-0 left-0 z-[2] overflow-visible" width={width} height={height}>
      <path
        vectorEffect="non-scaling-stroke"
        strokeLinecap="butt"
        strokeMiterlimit="8"
        fill="transparent"
        d={createPath(width, height)}
        stroke={outlineColor}
        strokeWidth={outlineWidth}
        strokeDasharray={strokeDashArray}
      />
    </svg>
  );
}
