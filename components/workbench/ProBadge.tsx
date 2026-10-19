/**
 * 本文件：Pro 模式徽章（工作台开关）。
 * 职责：以 role="switch" 的小徽章表达整页模式开关，带开关语义与工具提示。
 * 关键点：无 onToggle 时退化为纯展示徽章（disabled）；开态为紫底高亮，关态细边安静。
 */
'use client';

/**
 * The Pro badge — the switch into the workbench, worn on the wordmark's
 * shoulder like a trademark. `role="switch"` rather than a button, because it
 * has an on state that outlives the click.
 *
 * Ported from the spike's `ProBadge` (S9): it states the mode of the whole
 * page, which is exactly what a badge on the logo does and what a chip in a
 * toolbar cannot. Small, hairline, silent when off.
 */
import { motion, useReducedMotion } from 'motion/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils/cn';
import './pro-swap.css';

export interface ProBadgeProps {
  active: boolean;
  onToggle?: () => void;
  className?: string;
  /**
   * Override the default `pro-mode-exit` / `pro-mode-enter` testid.
   *
   * The workspace hero wears its own interactive badge while the rail keeps
   * the persistent switch. A distinct id keeps both controls addressable.
   */
  testId?: string;
}

/** Pro 模式徽章：active 表示已进入工作台；提供 onToggle 时可点击切换并显示提示。 */
export function ProBadge({ active, onToggle, className, testId }: ProBadgeProps) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const interactive = !!onToggle;

  const badge = (
    <motion.button
      type="button"
      role={interactive ? 'switch' : undefined}
      aria-checked={interactive ? active : undefined}
      aria-label={t('proMode.badgeAria')}
      data-testid={testId ?? (active ? 'pro-mode-exit' : 'pro-mode-enter')}
      data-pro-badge={active ? 'on' : 'off'}
      disabled={!interactive}
      onClick={onToggle}
      whileTap={reduceMotion || !interactive ? undefined : { scale: 0.94 }}
      className={cn(
        'relative inline-flex select-none items-center rounded-full border',
        'px-[7px] py-[2px] text-[9.5px] font-semibold uppercase leading-[1.35]',
        'tracking-[0.2em] transition-[color,background-color,border-color,box-shadow] duration-300',
        interactive ? 'cursor-pointer' : 'cursor-default',
        active
          ? [
              'border-blue-500/70 bg-blue-600 text-white',
              'shadow-[0_0_0_3px_rgba(96,165,250,0.14),0_1px_6px_rgba(30,64,175,0.35)]',
              'dark:border-blue-400/60 dark:bg-blue-500',
            ]
          : [
              'border-border bg-background/70 text-muted-foreground',
              'hover:border-blue-400/70 hover:bg-blue-50/60 hover:text-blue-600',
              'dark:hover:bg-blue-500/10',
              'dark:hover:border-blue-400/40 dark:hover:text-blue-300',
            ],
        className,
      )}
    >
      {/* The negative right margin pays back the trailing letter-space that
          `tracking` adds after the O, so the word sits centred in the pill. */}
      <span className="-mr-[0.2em]">Pro</span>
    </motion.button>
  );

  if (!interactive) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {active ? t('proMode.badgeExit') : t('proMode.badgeEnter')}
      </TooltipContent>
    </Tooltip>
  );
}
