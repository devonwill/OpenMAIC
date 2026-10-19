/**
 * 本文件：思考条折叠状态的纯逻辑。
 * 职责：维护「首次渲染必折叠、只有点击能开合」的规则，并提供
 * 摘要文案、单行预览等纯函数，脱离 DOM 可单测。
 * 关键点：状态变化（流式→完成）必须是 no-op，防止运行结束时
 * 强行收起用户刚手动展开的面板。
 */
'use client';

/**
 * Collapse logic for the thinking bar, kept out of the component so it can be
 * unit-tested without a DOM. Ported from OpenPBL's `thinking-bar-state.ts`.
 *
 * The rule the UI has to honour is small but easy to get wrong by accident:
 * the bar is ALWAYS collapsed on first render, and nothing except a click may
 * open or close it — in particular a run finishing must not yank the panel
 * shut under a reader who just opened it.
 */
import { useCallback, useState } from 'react';
import { defaultWorkbenchTranslator, type WorkbenchTranslator } from '@/lib/i18n/workbench';

/** 状态形状：touched 标记用户是否点过，使用户选择跨越状态更新存活。 */
export type ThinkingBarState = {
  /** Set once the user has clicked the bar, so the choice outlives status changes. */
  readonly touched: boolean;
  readonly expanded: boolean;
};

/** 初始态：未点过、已折叠——首次渲染始终折叠。 */
export const collapsedThinkingBar: ThinkingBarState = { touched: false, expanded: false };

/** 点击切换开合，并标记 touched。 */
export function toggleThinkingBar(state: ThinkingBarState): ThinkingBarState {
  return { touched: true, expanded: !state.expanded };
}

/**
 * The streaming -> done transition is deliberately a no-op. It exists as a
 * named function so the "status changes must not move the disclosure" rule is
 * something a test can pin, rather than an absence of code that a later edit
 * could silently fill in.
 */
/** 状态变化不移动折叠位的显式实现，供测试钉住该规则。 */
export function onThinkingStatusChange(state: ThinkingBarState): ThinkingBarState {
  return state;
}

/** 头部摘要：流式中显示「思考中」，结束后显示带耗时的完成态。 */
/** Header text: activity while the model is still emitting, elapsed time once not. */
export function thinkingBarSummary(
  {
    streaming,
    duration,
  }: {
    streaming: boolean;
    duration?: string;
  },
  t: WorkbenchTranslator = defaultWorkbenchTranslator,
): string {
  if (streaming) return t('workbench.thinking.active');
  return duration
    ? t('workbench.thinking.doneWithDuration', { duration })
    : t('workbench.thinking.done');
}

const PREVIEW_MAX = 200;

/**
 * The one-line peek shown on the collapsed bar. While streaming this is the
 * newest line, so the bar visibly moves; once done it is the model's last
 * line, which is where its conclusion lands. Capped so a single unbroken
 * paragraph cannot put a 50k-character text node in the DOM for a row that is
 * one line tall.
 */
/**
 * 折叠时的一行预览：取最后一个非空行并截断到 200 字符，
 * 流式中随之滚动，同时避免超长段落撑出巨型文本节点。
 */
export function thinkingBarPreview(text: string): string {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX)}…` : line;
  }
  return '';
}

/** 把状态封装为组件 Hook：暴露 expanded 与稳定的 toggle 回调。 */
export function useThinkingBar(): { expanded: boolean; toggle: () => void } {
  const [state, setState] = useState<ThinkingBarState>(collapsedThinkingBar);
  const toggle = useCallback(() => setState(toggleThinkingBar), []);
  return { expanded: state.expanded, toggle };
}
