/**
 * 本文件：工作台对话空状态。
 * 职责：在「会话从未有过一轮对话」时显示占位文案，避免 rail 上下留白成黑洞。
 * 关键点：是否显示是会话 fold 的纯函数（无消息、未回放、非实时），
 * 不新增任何状态，保证占位不会盖住已有记录或进行中的轮次。
 */
'use client';

/**
 * Workbench chat empty state — the idle placeholder for a conversation that
 * has never had a turn.
 *
 * The empty case is real: an existing classroom opened in Pro mode attaches a
 * fresh session whose log stays empty until the user's first message (see
 * `lib/workbench/existing-course.ts` — a new attach is idle, no model turn
 * until the user types). Without a placeholder the rail is a void between the
 * header and the composer.
 *
 * The rule is a pure function of the fold — no messages, not replaying, not
 * live — so the placeholder cannot linger over a transcript or a running
 * turn. No state is added anywhere; the predicate just picks the render.
 */
import { wbStyles as styles } from './chat-styles';
import type { ChatNode } from '@/lib/workbench/session-store';
import { defaultWorkbenchTranslator, type WorkbenchTranslator } from '@/lib/i18n/workbench';

/** 空态标题与提示语的默认文案常量，供时间线之外的引用处复用。 */
export const EMPTY_STATE_TITLE = defaultWorkbenchTranslator('workbench.chat.emptyTitle');
export const EMPTY_STATE_HINT = defaultWorkbenchTranslator('workbench.chat.emptyHint');

/**
 * Whether the empty placeholder should replace the timeline.
 *
 * `live` is the composer's STOP state (a run is live, queued, connecting, or
 * a send is in flight): the placeholder must vanish the instant the user
 * speaks, before the fold even lands the bubble.
 *
 * `catchingUp` is "this pane is supposed to hold a conversation and does not have
 * its log yet" — NOT the store's raw `replaying`. The two differ exactly where
 * this bug lived: a pane with no session at all (a brand-new conversation, whose
 * session the first message will create) has nothing to catch up to, and reading
 * `replaying` there left the placeholder off and the spinner on forever. The
 * spinner takes the whole rail when this is true, so the predicate and the
 * spinner must read the same value.
 */
/**
 * 判定是否渲染空态占位：无消息、非追赶中、非实时三者同时成立。
 * catchingUp 与 spinner 必须读同一语义，否则会出现占位消失但转圈永不停止。
 */
export function shouldShowWorkbenchEmptyState(input: {
  chat: readonly ChatNode[];
  catchingUp: boolean;
  live: boolean;
}): boolean {
  const { chat, catchingUp, live } = input;
  return chat.length === 0 && !catchingUp && !live;
}

// 纯展示组件：两行居中提示文案，无状态。
export function WorkbenchChatEmptyState({
  t = defaultWorkbenchTranslator,
}: {
  t?: WorkbenchTranslator;
} = {}) {
  return (
    <div className={styles.emptyState.root} data-testid="workbench-chat-empty">
      <p className={styles.emptyState.text}>{t('workbench.chat.emptyTitle')}</p>
      <p className={styles.emptyState.text}>{t('workbench.chat.emptyHint')}</p>
    </div>
  );
}
