/**
 * 本文件：选中图片元素的操作组（替换、水平/垂直翻转）。
 * 职责：挂载在 AnchoredElementBar 内，替换按钮弹出 Popover 复用 ImagePicker，
 * 翻转直接调用 use-slide-surface 的 toggleImageFlip。
 * 关键点：按钮 onMouseDown preventDefault，防止点击期间画布丢失选中态；
 * Popover 打开时阻止自动聚焦，避免抢走画布焦点。
 */
'use client';

import { FlipHorizontal, FlipVertical, ImageUp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { PPTImageElement } from '@openmaic/dsl';
import { ImagePicker } from './ImagePicker';
import { replaceImageSrc, toggleImageFlip } from './use-slide-surface';

const BTN =
  'flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

/**
 * Replace / flip controls for a selected image element. Mounted inside the
 * AnchoredElementBar (itself a portaled popover), so `onMouseDown` preventDefault
 * on each button keeps the canvas selection alive across the click.
 *
 * 中文要点：纯受控展示，无本地状态；替换走 replaceImageSrc(element.id, src)，
 * 翻转以当前元素对象为入参做布尔取反。
 */
export function ImageActions({ element }: { readonly element: PPTImageElement }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('edit.image.replace')}
            title={t('edit.image.replace')}
            onMouseDown={(e) => e.preventDefault()}
            className={BTN}
          >
            <ImageUp className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-72"
        >
          <ImagePicker onPick={(src) => replaceImageSrc(element.id, src)} />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={t('edit.image.flipH')}
        title={t('edit.image.flipH')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => toggleImageFlip(element, 'H')}
        className={BTN}
      >
        <FlipHorizontal className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={t('edit.image.flipV')}
        title={t('edit.image.flipV')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => toggleImageFlip(element, 'V')}
        className={BTN}
      >
        <FlipVertical className="h-4 w-4" />
      </button>
    </div>
  );
}
