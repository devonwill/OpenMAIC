/**
 * 本文件：非文本元素的锚定工具条。
 * 职责：为选中的图片/形状/线条等元素就近提供操作——图片可替换/裁剪/翻转，
 * 所有非文本元素均有层级调整与删除。
 * 关键点：按元素类型分支渲染操作项；文本元素走 AnchoredTextBar，不共用本条。
 */
'use client';

import type { PPTElement } from '@openmaic/dsl';
import { AnchoredBar } from './AnchoredBar';
import { DeleteButton } from './DeleteButton';
import { ImageActions } from './ImageActions';
import { ZOrderButtons } from './ZOrderButtons';

interface AnchoredElementBarProps {
  /** The selected non-text element, or null when none is selected. */
  readonly element: PPTElement | null;
}

const Separator = () => <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800" />;

/**
 * The selection-anchored bar for non-text elements (image, shape, line, …).
 * Type-aware: image elements get replace/crop/flip controls; every non-text
 * element gets z-order (to-front/to-back) + delete. Hugs the selected element
 * — see AnchoredBar for the shell. Text elements get their own AnchoredTextBar.
 */
export function AnchoredElementBar({ element }: AnchoredElementBarProps) {
  const elementId = element?.id ?? '';
  return (
    <AnchoredBar elementId={elementId}>
      <div className="flex items-center gap-1">
        {element?.type === 'image' && (
          <>
            <ImageActions element={element} />
            <Separator />
          </>
        )}
        <ZOrderButtons elementId={elementId} />
        <Separator />
        <DeleteButton elementId={elementId} />
      </div>
    </AnchoredBar>
  );
}
