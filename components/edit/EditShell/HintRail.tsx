/**
 * 本文件：编辑器底部 AI 提示条（HintRail）。
 * 职责：以浮层卡片渲染 surface 返回的编辑提示（info/suggestion/warning 三级），
 * 并可把自身高度写入 CSS 变量为布局预留空间。
 * 关键点：容器 pointer-events-none，仅提示卡上的操作按钮恢复可点；
 * 无提示时返回 null，预留空间用 ResizeObserver 跟随内容高度。
 */
'use client';

import { Info, Lightbulb, AlertTriangle } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { EditorHint } from '@/lib/edit/scene-editor-surface';

interface HintRailProps {
  readonly hints?: readonly EditorHint[];
  readonly reserveSpace?: boolean;
}

/**
 * Reserved AI inline-coach surface. Renders nothing in Phase 1 (surfaces
 * return [] for hints). Layout slot is wired so future phases can populate
 * it without restructuring the shell.
 */
/** 底部编辑提示条：无提示不渲染；reserveSpace 时向宿主暴露自身高度。 */
export function HintRail({ hints, reserveSpace = false }: HintRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const rail = railRef.current;
    const host = rail?.parentElement;
    if (!reserveSpace || !rail || !host) return;

    const updateReservedSpace = () => {
      host.style.setProperty(
        '--editor-hint-rail-height',
        `${rail.getBoundingClientRect().height}px`,
      );
    };
    updateReservedSpace();

    const observer = new ResizeObserver(updateReservedSpace);
    observer.observe(rail);
    return () => {
      observer.disconnect();
      host.style.removeProperty('--editor-hint-rail-height');
    };
  }, [hints, reserveSpace]);

  if (!hints || hints.length === 0) return null;

  return (
    <div
      ref={railRef}
      className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2"
    >
      <div className="flex max-w-md flex-col gap-2">
        {hints.map((hint) => (
          <HintCard key={hint.id} hint={hint} />
        ))}
      </div>
    </div>
  );
}

const ICONS = {
  info: Info,
  suggestion: Lightbulb,
  warning: AlertTriangle,
} as const;

const SEVERITY_STYLES = {
  info: 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200',
  suggestion:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100',
  warning:
    'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100',
} as const;

function HintCard({ hint }: { readonly hint: EditorHint }) {
  const Icon = ICONS[hint.severity];
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-md shadow-zinc-900/5 ${SEVERITY_STYLES[hint.severity]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">{hint.message}</div>
      {hint.action && (
        <button
          type="button"
          onClick={hint.action.onInvoke}
          className="pointer-events-auto shrink-0 rounded-md bg-white/60 px-2.5 py-1 text-xs font-medium hover:bg-white dark:bg-zinc-800/60 dark:hover:bg-zinc-800"
        >
          {hint.action.label}
        </button>
      )}
    </div>
  );
}
