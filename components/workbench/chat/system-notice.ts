/**
 * 本文件：系统通知的呈现逻辑（纯函数）。
 * 职责：把生命周期标记渲染为「摘要 + 可选提示 + 可选技术细节」，
 * 并把相邻的同事实通知折叠为带计数的一行。
 * 关键点：技术细节永不拼进句子（原始报错是开发者语言）；折叠仅发生在
 * 渲染层，fold 仍保留每条标记，回放与实时呈现完全一致。
 */
/**
 * System notice presentation — the one place that decides how a lifecycle
 * marker READS, and the one place that knows two adjacent markers can be the
 * same fact reported twice.
 *
 * Two rules, both pure (so a replayed log presents identically to a live one,
 * and neither needs a DOM to be tested):
 *
 *  1. A notice is a summary, optionally a hint (what you can do), optionally a
 *     technical cause. The cause never joins the sentence: the raw provider
 *     string is developer prose, and inlining it turned a failed run into a
 *     console line — the failure text and its retry hint welded into one run-on
 *     sentence, with the two languages' punctuation spliced together.
 *  2. Consecutive identical notices collapse to one row with a count. Each
 *     automatic retry appends its own failure marker, so a provider outage used
 *     to print five byte-identical lines; the count says "five times" without
 *     five rows. The collapse is render-only — the fold keeps every marker, so
 *     the transcript remains a faithful record.
 */
import type { ChatNode, SystemTone } from '@/lib/workbench/session-store';
import { defaultWorkbenchTranslator, type WorkbenchTranslator } from '@/lib/i18n/workbench';

/**
 * `stopped` is the cancel boundary rather than a `SystemTone`: it renders in
 * the centered caption register, not as a left-aligned notice row, but it is
 * the same vocabulary of copy + icon + count, so it presents through here too.
 */
/** 通知语调：含 stopped（居中字幕位的取消边界，呈现走同一套词汇）。 */
export type NoticeTone = SystemTone | 'stopped';

/** 一条通知的数据形状：summary 必填，detail 只进展开区。 */
export interface SystemNotice {
  tone: NoticeTone;
  /** One statement of what happened. Never carries the technical cause. */
  summary: string;
  /** What the user can do next, one clause. */
  hint?: string;
  /** The raw cause, verbatim, for the disclosure. */
  detail?: string;
}

/** Notice-shaped nodes: everything the run says about itself. */
/** 是否为通知类节点：system（系统消息）与 boundary（轮次边界）。 */
export function isNoticeNode(node: ChatNode): boolean {
  return node.kind === 'system' || node.kind === 'boundary';
}

/**
 * Sentence-final punctuation a UI line does not need. Stripped from the
 * summary and the hint so a copy edit cannot leave a trailing stop or the
 * double stop that concatenation used to produce.
 */
const TRAILING_STOPS = /[。．.,，、;；:：!！?？\s]+$/u;

const oneLine = (value: string): string =>
  value.replace(/\s+/gu, ' ').trim().replace(TRAILING_STOPS, '');

/**
 * The cause keeps its own line breaks (a stack trace is easier to read as
 * one), and only loses surrounding blank space and a dangling separator — the
 * shape of `"gateway 524: "`, accurate and unreadable on its own.
 */
const cleanDetail = (value: string): string => value.trim().replace(/[\s:：]+$/u, '');

/** 把节点转成可呈现的通知：翻译 copyKey、归一单行、清理细节尾部悬挂分隔符。 */
export function presentSystemNotice(
  node: ChatNode,
  t: WorkbenchTranslator = defaultWorkbenchTranslator,
): SystemNotice {
  const tone: NoticeTone = node.kind === 'boundary' ? 'stopped' : (node.tone ?? 'info');
  const summary = oneLine(node.copyKey ? t(node.copyKey) : node.text);
  const hint = node.hintCopyKey
    ? oneLine(t(node.hintCopyKey))
    : node.hint
      ? oneLine(node.hint)
      : '';
  const detail = node.detail ? cleanDetail(node.detail) : '';
  return {
    tone,
    summary,
    ...(hint ? { hint } : {}),
    ...(detail ? { detail } : {}),
  };
}

/**
 * Are these two markers the same fact? Everything the notice can show has to
 * match — a second failure with a DIFFERENT cause is new information and keeps
 * its own row, however similar the summary looks.
 */
/** 两标记是否同一事实：所有可展示字段都必须一致，细节不同则各自成行。 */
export function isSameNotice(a: ChatNode, b: ChatNode): boolean {
  if (!isNoticeNode(a) || !isNoticeNode(b)) return false;
  return (
    a.kind === b.kind &&
    (a.tone ?? 'info') === (b.tone ?? 'info') &&
    (a.copyKey ?? a.text) === (b.copyKey ?? b.text) &&
    (a.detail ?? '') === (b.detail ?? '') &&
    (a.hintCopyKey ?? a.hint ?? '') === (b.hintCopyKey ?? b.hint ?? '')
  );
}

/** 折叠后的重复计数徽标（×N）及其完整读法 title。 */
/** The count badge. `×5` is the recognised idiom; the title spells it out. */
export function repeatLabel(repeat: number): string {
  return `×${repeat}`;
}

export function repeatTitle(
  repeat: number,
  t: WorkbenchTranslator = defaultWorkbenchTranslator,
): string {
  return t('workbench.system.repeated', { count: repeat });
}
