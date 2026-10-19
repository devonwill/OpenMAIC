/**
 * 本文件：首 token 前的等待条组件。
 * 职责：渲染三个脉冲圆点，表示服务端已收到请求但尚未产出内容。
 * 关键点：与思考条刻意分离——不显示「思考中」标签，不伪造思考内容；
 * 首个真实分片到达即由会话 fold 移除。
 */
'use client';

/**
 * Pre-token loading — three pulsing dots. OpenPBL keeps this separate from
 * the thinking bar: no "thinking" label, no brain icon, no fabricated thought.
 * The fold opens it on session start / user message / message start / tool
 * end, and removes it the moment the first real part arrives.
 */
import { wbStyles as styles } from './chat-styles';
import { defaultWorkbenchTranslator, type WorkbenchTranslator } from '@/lib/i18n/workbench';

// 无状态展示组件：样式取自 chat-styles，文案经 i18n 翻译器注入。
export function WaitingBar({
  t = defaultWorkbenchTranslator,
}: {
  t?: WorkbenchTranslator;
} = {}) {
  return (
    <span
      className={styles.waiting.root}
      role="status"
      aria-label={t('workbench.chat.waiting')}
      data-testid="workbench-waiting-bar"
    >
      <span className={styles.waiting.dots} aria-hidden="true">
        <i className={styles.waiting.dot} />
        <i className={styles.waiting.dotDelayOne} />
        <i className={styles.waiting.dotDelayTwo} />
      </span>
    </span>
  );
}
