/**
 * 本文件：图片元素描边分发组件。
 * 职责：按裁剪形状（矩形/椭圆/多边形）选择对应的描边绘制实现。
 * 关键点：描边形状必须与 clip-path 形状一致，否则边框与图像轮廓错位。
 */
'use client';

import type { PPTImageElement } from '@openmaic/dsl';
import { useClipImage } from '../useClipImage';
import { ImageRectOutline } from './image-rect-outline';
import { ImageEllipseOutline } from './image-ellipse-outline';
import { ImagePolygonOutline } from './image-polygon-outline';

export interface ImageOutlineProps {
  elementInfo: PPTImageElement;
}

/**
 * Image outline dispatcher based on clip shape type
 *
 * 中文：多边形描边依赖 clipShape.createPath，由 polygon 类型裁剪提供。
 */
export function ImageOutline({ elementInfo }: ImageOutlineProps) {
  const { clipShape } = useClipImage(elementInfo);

  return (
    <div className="image-outline">
      {clipShape.type === 'rect' && (
        <ImageRectOutline
          width={elementInfo.width}
          height={elementInfo.height}
          radius={clipShape.radius}
          outline={elementInfo.outline}
        />
      )}
      {clipShape.type === 'ellipse' && (
        <ImageEllipseOutline
          width={elementInfo.width}
          height={elementInfo.height}
          outline={elementInfo.outline}
        />
      )}
      {clipShape.type === 'polygon' && (
        <ImagePolygonOutline
          width={elementInfo.width}
          height={elementInfo.height}
          outline={elementInfo.outline}
          createPath={clipShape.createPath!}
        />
      )}
    </div>
  );
}
