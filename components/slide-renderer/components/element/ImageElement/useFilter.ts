/**
 * 本文件：图片滤镜的 CSS 字符串转换。
 * 职责：把 DSL 滤镜映射转为 CSS filter 函数串（如 blur(2px) brightness(120%)）。
 * 关键点：各滤镜单位不同（px/%/deg），已在 FILTER_UNITS 中登记。
 */
import { useMemo } from 'react';
import type { ImageElementFilterKeys, ImageElementFilters } from '@openmaic/dsl';

const FILTER_UNITS: Record<ImageElementFilterKeys, string> = {
  blur: 'px',
  brightness: '%',
  contrast: '%',
  grayscale: '%',
  saturate: '%',
  'hue-rotate': 'deg',
  sepia: '%',
  invert: '%',
  opacity: '%',
};

/** 纯函数：拼接 CSS filter 串；空值项跳过，缺单位时补默认单位。 */
export function imageFiltersToCss(filters?: ImageElementFilters): string {
  if (!filters) return '';
  const parts: string[] = [];
  for (const [name, value] of Object.entries(filters) as [ImageElementFilterKeys, string][]) {
    if (value === undefined || value === null || value === '') continue;
    const unit = FILTER_UNITS[name] ?? '';
    const rendered = unit && !value.endsWith(unit) ? `${value}${unit}` : value;
    parts.push(`${name}(${rendered})`);
  }
  return parts.join(' ');
}

/**
 * Calculate a CSS filter string from the current DSL filter map.
 */
export function useFilter(filters?: ImageElementFilters) {
  const filter = useMemo(() => {
    return imageFiltersToCss(filters);
  }, [filters]);

  return {
    filter,
  };
}
