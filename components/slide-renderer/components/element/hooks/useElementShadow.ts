/**
 * 本文件：元素阴影样式的 Hook。
 * 职责：把阴影对象（水平/垂直偏移、模糊、颜色）转换为 CSS box-shadow 字符串。
 * 关键点：无阴影时返回空串，调用方直接展开进 style 即可。
 */
import { useMemo } from 'react';
import type { PPTElementShadow } from '@openmaic/dsl';

/**
 * Calculate element shadow style
 * Converts shadow object to CSS box-shadow string
 * @param shadow Shadow configuration
 */
export function useElementShadow(shadow?: PPTElementShadow) {
  const shadowStyle = useMemo(() => {
    if (shadow) {
      const { h, v, blur, color } = shadow;
      return `${h}px ${v}px ${blur}px ${color}`;
    }
    return '';
  }, [shadow]);

  return {
    shadowStyle,
  };
}
