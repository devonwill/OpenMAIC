/**
 * 本文件：形状元素填充样式的 Hook。
 * 职责：按 图案 > 渐变 > 纯色 的优先级生成 SVG fill 值。
 * 关键点：图案/渐变引用依赖 defs 中按元素 id 生成的唯一 id，id 规则需与
 *       GradientDefs/PatternDefs 保持一致。
 */
import { useMemo } from 'react';
import type { PPTShapeElement } from '@openmaic/dsl';

/**
 * Calculate element fill style
 * Returns pattern/gradient URL or solid color fill
 * @param element Shape element
 * @param source Source identifier for pattern/gradient IDs
 */
export function useElementFill(element: PPTShapeElement, source: string) {
  const fill = useMemo(() => {
    if (element.pattern) return `url(#${source}-pattern-${element.id})`;
    if (element.gradient) return `url(#${source}-gradient-${element.id})`;
    return element.fill || 'none';
  }, [element.pattern, element.gradient, element.fill, element.id, source]);

  return {
    fill,
  };
}
