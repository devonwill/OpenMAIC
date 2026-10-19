/**
 * 本文件：折叠面板的侧边标签条。
 * 职责：面板收起为零宽时，在对应边缘留一条竖排文字窄条作为展开入口。
 * 关键点：窄条是唯一交互暗示——单按钮、无菜单、无图标，文字即标签。
 */
'use client';

/**
 * A collapsed pane's way back.
 *
 * A pane that collapses to nothing is a pane the user has to guess is still
 * there, so every collapse leaves a 30px strip carrying the pane's name set
 * vertically. It is the whole affordance: one button, one label, no menu — and
 * no icon: the strip already spells out "chat" / "course", and a glyph above
 * the word it duplicates is the kind of decoration this pass removes.
 */

import { cn } from '@/lib/utils/cn';

// side 仅决定贴边样式（接缝方向），不改变交互行为。
export function PaneTab({
  testId,
  label,
  side = 'left',
  onClick,
}: {
  readonly testId: string;
  readonly label: string;
  /** Which edge the strip sits on — only its seam changes. */
  readonly side?: 'left' | 'right';
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'ws-tab flex h-full shrink-0 flex-col items-center pt-4',
        side === 'right' && 'ws-pane-last',
      )}
    >
      <span aria-hidden="true" className="ws-tab-label truncate">
        {label}
      </span>
    </button>
  );
}
