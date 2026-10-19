/**
 * 本文件：图片裁剪形状与图片定位的计算 Hook。
 * 职责：由 clip 配置生成 CSS clip-path，以及图片在裁剪框内的缩放偏移。
 * 关键点：圆角元素会覆盖裁剪形状的 radius；未裁剪时图片铺满 100%。
 */
import { useMemo } from 'react';
import type { PPTImageElement } from '@openmaic/dsl';
import { CLIPPATHS, ClipPathTypes } from '@/configs/image-clip';

/**
 * Calculate image clip shape and position
 * @param element Image element
 */
export function useClipImage(element: PPTImageElement) {
  const clipShape = useMemo(() => {
    let _clipShape = CLIPPATHS.rect;

    if (element.clip) {
      const shape = element.clip.shape || ClipPathTypes.RECT;
      _clipShape = CLIPPATHS[shape];
    }
    if (_clipShape.radius !== undefined && element.radius !== undefined) {
      _clipShape = {
        ..._clipShape,
        radius: `${element.radius}px`,
        style: `inset(0 round ${element.radius}px)`,
      };
    }

    return _clipShape;
  }, [element.clip, element.radius]);

  const imgPosition = useMemo(() => {
    // 无裁剪范围时图片填满容器
    if (!element.clip || !element.clip.range) {
      return {
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
      };
    }

    // 裁剪 range 为百分比区间；把可见区放大到 100%/scale，
    // 再按起点反向平移，等价于把整图对齐到裁剪窗口（坐标换算需与导出一致）
    const [start, end] = element.clip.range;

    const widthScale = (end[0] - start[0]) / 100;
    const heightScale = (end[1] - start[1]) / 100;
    const left = start[0] / widthScale;
    const top = start[1] / heightScale;

    return {
      left: -left + '%',
      top: -top + '%',
      width: 100 / widthScale + '%',
      height: 100 / heightScale + '%',
    };
  }, [element.clip]);

  return {
    clipShape,
    imgPosition,
  };
}
