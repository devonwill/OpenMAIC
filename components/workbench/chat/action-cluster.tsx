/**
 * 本文件：连续动作条聚合组件。
 * 职责：把相邻的思考条、工具卡、首 token 等待条合并进同一栈渲染。
 * 关键点：纯工具轮次交给 ToolGroup；混合轮次共用一个框，
 * 条目间以细线分隔而非 16px 时间线间距，避免视觉跳变。
 */
'use client';

/**
 * Consecutive action bars (thinking + tools + the pre-token wait) share one
 * stack. Tools-only runs keep ToolGroup; mixed runs share one frame so the
 * bars sit on hairlines instead of a 16px timeline gap.
 */
import type { ChatNode, PlannedPage } from '@/lib/workbench/session-store';
import { defaultWorkbenchTranslator, type WorkbenchTranslator } from '@/lib/i18n/workbench';
import { wbStyles as styles } from './chat-styles';
import { ThinkingBlock } from './thinking-block';
import { ToolCard } from './tool-card';
import { ToolGroup, stackPosition } from './tool-group';
import { WaitingBar } from './waiting-bar';

// 把首尾的 waiting 分离出来：等待条不属于可折叠的动作栈本体。
export function ActionCluster({
  nodes,
  plan = [],
  t = defaultWorkbenchTranslator,
}: {
  nodes: ChatNode[];
  plan?: PlannedPage[];
  t?: WorkbenchTranslator;
}) {
  if (nodes.length === 0) return null;

  const trailingWait = nodes.at(-1)?.kind === 'waiting';
  const bars = nodes.filter((node) => node.kind !== 'waiting');

  if (bars.length === 0) return <WaitingBar t={t} />;

  // 只有工具节点时用 ToolGroup 聚合折叠，混排则逐条平铺。
  const stack = bars.every((node) => node.kind === 'tool') ? (
    <ToolGroup nodes={bars} plan={plan} t={t} />
  ) : (
    <div className={styles.actionCluster.root} data-testid="workbench-action-cluster">
      {bars.map((node, index) =>
        node.kind === 'thinking' ? (
          <ThinkingBlock
            key={node.key}
            text={node.text}
            streaming={node.streaming}
            startedAt={node.startedAt}
            endedAt={node.endedAt}
            stackPosition={stackPosition(index, bars.length)}
            t={t}
          />
        ) : node.kind === 'tool' ? (
          <ToolCard
            key={node.key}
            node={node}
            plan={plan}
            stackPosition={stackPosition(index, bars.length)}
            t={t}
          />
        ) : null,
      )}
    </div>
  );

  // 末尾仍在等待（尚未产出新分片）时，把等待条接在栈底。
  if (!trailingWait) return stack;
  return (
    <div className={styles.actionCluster.withWait}>
      {stack}
      <WaitingBar t={t} />
    </div>
  );
}
