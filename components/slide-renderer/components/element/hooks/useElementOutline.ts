/**
 * 本文件：元素描边（边框）样式的 Hook。
 * 职责：把描边配置归一化为宽度/样式/颜色，并生成虚线、点线的 SVG dash 数组。
 * 关键点：dash 间距按线宽分档缩放，保证粗细描边在导出与屏幕上观感一致。
 */
import { useMemo } from 'react';
import type { PPTElementOutline } from '@openmaic/dsl';

/**
 * Calculate element outline (border) styles
 * Handles default values and stroke dash array for dashed/dotted borders
 * @param outline Outline configuration
 */
export function useElementOutline(outline?: PPTElementOutline) {
  const outlineWidth = useMemo(() => outline?.width ?? 0, [outline?.width]);

  const outlineStyle = useMemo(() => outline?.style || 'solid', [outline?.style]);

  const outlineColor = useMemo(() => outline?.color || '#d14424', [outline?.color]);

  const strokeDashArray = useMemo(() => {
    // 虚线/点线的段长随线宽变化；线宽超过 6px 后改用更紧凑的比例，
    // 避免粗描边出现过长的空隙（纯视觉调参，导出端沿用同一套数值）。
    const size = outlineWidth;
    if (outlineStyle === 'dashed')
      return size <= 6 ? `${size * 4.5} ${size * 2}` : `${size * 4} ${size * 1.5}`;
    if (outlineStyle === 'dotted')
      return size <= 6 ? `${size * 1.8} ${size * 1.6}` : `${size * 1.5} ${size * 1.2}`;
    return '0 0';
  }, [outlineWidth, outlineStyle]);

  return {
    outlineWidth,
    outlineStyle,
    outlineColor,
    strokeDashArray,
  };
}
