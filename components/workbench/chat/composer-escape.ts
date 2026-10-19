/**
 * 本文件：双击 Esc 停止生成的判定与 Hook。
 * 职责：生成期间第一次 Esc 进入「预备」态，窗口期内再按一次才真正停止，
 * 防止单次误触中断长任务；同时允许浮层（data-esc-owner）独占 Esc。
 * 关键点：判定逻辑抽成纯函数便于测试，Hook 只负责键盘绑定与预备态计时。
 */
'use client';

import { useEffect, useState } from 'react';

/** How long the first Escape stays armed. */
// 首次 Esc 的预备有效窗口：超时自动解除预备。
export const DOUBLE_ESCAPE_WINDOW_MS = 600;

/** 三种处理意图：忽略 / 进入预备 / 执行停止。 */
export type EscapeStopIntent = 'ignore' | 'arm' | 'stop';

/** 纯函数判定本次 Esc 的意图：浮层独占或未在生成时忽略，窗口内二次按为 stop，否则 arm。 */
export function resolveEscapeStopIntent(input: {
  generating: boolean;
  overlayOwnsEscape: boolean;
  armedAt: number | null;
  now: number;
  windowMs?: number;
}): EscapeStopIntent {
  const { generating, overlayOwnsEscape, armedAt, now, windowMs = DOUBLE_ESCAPE_WINDOW_MS } = input;
  if (overlayOwnsEscape) return 'ignore';
  if (!generating) return 'ignore';
  if (armedAt !== null && now - armedAt >= 0 && now - armedAt <= windowMs) return 'stop';
  return 'arm';
}

// 页面上存在声明了 Esc 所有权的浮层时，停止逻辑必须让位。
export function overlayOwnsEscape(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[data-esc-owner]') !== null;
}

/**
 * 绑定全局 Esc 监听，维护预备态并触发 onStop。
 * armed 返回给 UI 显示「再按一次停止」提示；组件卸载时移除监听。
 */
export function useDoubleEscapeStop({
  generating,
  onStop,
  windowMs = DOUBLE_ESCAPE_WINDOW_MS,
}: {
  generating: boolean;
  onStop: () => void;
  windowMs?: number;
}): { armed: boolean } {
  const [armedAt, setArmedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!generating) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const intent = resolveEscapeStopIntent({
        generating,
        overlayOwnsEscape: overlayOwnsEscape(),
        armedAt,
        now: Date.now(),
        windowMs,
      });
      if (intent === 'ignore') return;
      if (intent === 'arm') {
        setArmedAt(Date.now());
        return;
      }
      setArmedAt(null);
      onStop();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [armedAt, generating, onStop, windowMs]);

  useEffect(() => {
    if (armedAt === null) return;
    const timer = setTimeout(() => setArmedAt(null), windowMs);
    return () => clearTimeout(timer);
  }, [armedAt, windowMs]);

  return { armed: generating && armedAt !== null };
}
