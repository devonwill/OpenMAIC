'use client';

import { Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { deleteSlideElement } from './use-slide-surface';

/**
 * 本文件：锚定工具条上的删除按钮。
 * 职责：点击删除当前选中的幻灯片元素。
 * 关键点：mousedown 阻止默认行为以保住画布选中态，等 click 再执行删除。
 */
/** Trash button for the anchored bars — deletes the element and clears the selection. */
export function DeleteButton({ elementId }: { readonly elementId: string }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t('edit.delete')}
      // preventDefault on mousedown keeps the canvas selection alive until the
      // click fires; the op then deletes the element.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => deleteSlideElement(elementId)}
      className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
