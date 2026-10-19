/**
 * 本文件：置顶 / 置底层级按钮对。
 * 职责：锚定工具条中的 z 序快捷操作，仅支持"一步到顶/一步到底"，
 * 中间层级的逐步上移下移留给 AI 编辑能力。
 * 关键点：onMouseDown preventDefault 防止点击时画布丢失选中态；
 * 相同图标靠 Tooltip 文案区分。
 */
'use client';

import { BringToFront, SendToBack } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/hooks/use-i18n';
import { reorderSlideElement } from './use-slide-surface';

const BTN =
  'flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

/**
 * To-front / to-back z-order buttons for the anchored bars. Two-way only —
 * intermediate forward/backward steps stay AI's domain. The icons are
 * disambiguated by a hover tooltip. `onMouseDown` preventDefault keeps the
 * canvas selection alive until the click fires.
 *
 * 中文要点：点击仅触发 reorderSlideElement(elementId, 'front' | 'back')，
 * 不维护本地状态，层级以 store 回读为准。
 */
export function ZOrderButtons({ elementId }: { readonly elementId: string }) {
  const { t } = useI18n();
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('edit.zorder.toFront')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => reorderSlideElement(elementId, 'front')}
            className={BTN}
          >
            <BringToFront className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('edit.zorder.toFront')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('edit.zorder.toBack')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => reorderSlideElement(elementId, 'back')}
            className={BTN}
          >
            <SendToBack className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('edit.zorder.toBack')}</TooltipContent>
      </Tooltip>
    </>
  );
}
