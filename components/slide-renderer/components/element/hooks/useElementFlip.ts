/**
 * 本文件：元素水平/垂直翻转样式的 Hook。
 * 职责：把翻转标志换算为 rotateX/rotateY 变换字符串。
 * 关键点：双向翻转等价于旋转 180°，此处拆成两个轴变换以保留翻转语义。
 */
import { useMemo } from 'react';

/**
 * Calculate element flip transform style
 * Handles horizontal and/or vertical flip
 * @param flipH Flip horizontally
 * @param flipV Flip vertically
 */
export function useElementFlip(flipH?: boolean, flipV?: boolean) {
  const flipStyle = useMemo(() => {
    let style = '';

    if (flipH && flipV) style = 'rotateX(180deg) rotateY(180deg)';
    else if (flipV) style = 'rotateX(180deg)';
    else if (flipH) style = 'rotateY(180deg)';

    return style;
  }, [flipH, flipV]);

  return {
    flipStyle,
  };
}
