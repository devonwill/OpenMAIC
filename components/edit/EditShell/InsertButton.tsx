/**
 * 本文件：插入面板单项按钮。
 * 职责：把一个 InsertPaletteItem 渲染为按钮，兼作 popover 触发器
 * （条目声明 popoverContent 时弹出取色器等子面板）。
 * 关键点：Tooltip 与 Popover 的 asChild Slot 逐层链到真实 button 上，
 * 否则外层 Tooltip（Provider）会吞掉 popover 的触发处理器。
 */
'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { InsertPaletteItem } from '@/lib/edit/scene-editor-surface';
import { cn } from '@/lib/utils';

interface Props {
  readonly item: InsertPaletteItem;
  readonly iconOnly?: boolean;
  readonly popoverSide?: 'bottom' | 'right';
}

/**
 * Single insert-palette button. Reused by both the (legacy) CommandBar
 * insert slot and the FloatingInsertToolbar at the canvas's left edge.
 *
 * When the item declares `popoverContent`, the button doubles as a
 * popover trigger — and PopoverTrigger's `asChild` Slot is chained
 * directly onto the real `<button>` so wrapping a `<Tooltip>`
 * (provider, not DOM) doesn't drop the popover trigger handler.
 *
 * 中文要点：无 popoverContent 时仅是普通按钮；有则按钮只负责触发弹层，
 * 点击动作交给弹层内容执行。
 */
export function InsertButton({ item, iconOnly = false, popoverSide = 'bottom' }: Props) {
  const button = (
    <button
      type="button"
      disabled={item.disabled}
      onClick={item.popoverContent ? undefined : item.onInvoke}
      aria-label={iconOnly ? item.label : undefined}
      aria-pressed={typeof item.active === 'boolean' ? item.active : undefined}
      className={cn(
        'group flex h-9 items-center rounded-xl transition-colors disabled:pointer-events-none disabled:opacity-40',
        iconOnly ? 'w-9 justify-center px-0' : 'gap-1.5 px-3',
        item.active
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
      )}
    >
      <span className="flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
        {item.icon}
      </span>
      {!iconOnly && <span className="text-xs font-medium">{item.label}</span>}
    </button>
  );

  const triggerWithTooltip = (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      {item.tooltip && (
        <TooltipContent side={iconOnly ? 'right' : undefined}>{item.tooltip}</TooltipContent>
      )}
    </Tooltip>
  );

  if (!item.popoverContent) return triggerWithTooltip;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{button}</PopoverTrigger>
        </TooltipTrigger>
        {item.tooltip && (
          <TooltipContent side={iconOnly ? 'right' : undefined}>{item.tooltip}</TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        side={popoverSide}
        align={popoverSide === 'right' ? 'start' : 'center'}
        className="w-80 p-3"
      >
        {item.popoverContent()}
      </PopoverContent>
    </Popover>
  );
}
