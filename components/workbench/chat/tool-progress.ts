/**
 * 本文件：生成工具的步骤进度推导。
 * 职责：把 generate_scene 的实时 trace 映射为 4 步短进度条
 * （准备→内容→动作→保存），原始 trace 留在展开区。
 * 关键点：进度纯靠 trace 正则判定，可离线回放；非分阶段工具返回 null。
 */

/**
 * Map a generation tool's live traces onto a short step rail.
 * The bar shows these steps; raw traces stay behind the disclosure.
 */

import { defaultWorkbenchTranslator, type WorkbenchTranslator } from '@/lib/i18n/workbench';

/** 单步状态：待开始 / 进行中 / 已完成。 */
export type ToolStepState = 'pending' | 'active' | 'done';

export interface ToolStep {
  readonly id: string;
  readonly label: string;
  readonly state: ToolStepState;
}

export interface ToolProgress {
  readonly steps: ToolStep[];
  readonly caption: string;
}

// 从后向前找最后一条匹配的 trace 行，用来区分「已收到返回值」与「仅开始该阶段」。
function lastMatching(traces: string[], test: (line: string) => boolean): string | undefined {
  for (let i = traces.length - 1; i >= 0; i--) {
    const line = traces[i];
    if (line && test(line)) return line;
  }
  return undefined;
}

function mark(
  steps: { id: string; label: string }[],
  activeIndex: number,
  finished: boolean,
): ToolStep[] {
  return steps.map((step, i) => ({
    ...step,
    state: finished || i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending',
  }));
}

function sceneProgress(
  traces: string[],
  running: boolean,
  failed: boolean,
  t: WorkbenchTranslator,
): ToolProgress {
  const steps = [
    { id: 'prep', label: t('workbench.tool.progress.scene.prep') },
    { id: 'content', label: t('workbench.tool.progress.scene.content') },
    { id: 'actions', label: t('workbench.tool.progress.scene.actions') },
    { id: 'save', label: t('workbench.tool.progress.scene.save') },
  ];
  const hasContent = traces.some((t) => /generating content|llm\[scene-content/i.test(t));
  const hasActions = traces.some((t) => /generating actions|llm\[scene-actions/i.test(t));
  const llmContent = lastMatching(traces, (t) => /llm\[scene-content/i.test(t));
  const llmActions = lastMatching(traces, (t) => /llm\[scene-actions/i.test(t));

  let active = 0;
  let caption = t('workbench.tool.progress.scene.aligning');
  if (hasActions) {
    active = 2;
    caption = t(
      llmActions
        ? 'workbench.tool.progress.scene.arrangingReturnedActions'
        : 'workbench.tool.progress.scene.arrangingActions',
    );
  } else if (hasContent) {
    active = 1;
    caption = t(
      llmContent
        ? 'workbench.tool.progress.scene.layingOutReturnedContent'
        : 'workbench.tool.progress.scene.draftingContent',
    );
  }
  if (!running) {
    return {
      steps: mark(steps, failed ? active : steps.length, !failed),
      caption: t(
        failed ? 'workbench.tool.progress.scene.failed' : 'workbench.tool.progress.scene.done',
      ),
    };
  }
  return { steps: mark(steps, active, false), caption };
}

/** 按当前活动步推导进度条唯一展示的一行：优先活动步，否则最近完成步。 */
/** The one line the bar shows: current step, or the last finished one. */
export function progressLine(progress: ToolProgress): string {
  const active = progress.steps.find((step) => step.state === 'active');
  if (active) return active.label;
  const lastDone = [...progress.steps].reverse().find((step) => step.state === 'done');
  return lastDone?.label ?? progress.caption;
}

/** 仅有分阶段流水线的工具（上游仅 generate_scene）返回进度，其余返回 null。 */
/**
 * Null when this tool has no staged generation pipeline.
 *
 * Only `generate_scene` carries one in the upstream runtime. The reference also
 * mapped `generate_outline` traces onto a planning rail; the upstream agent
 * runtime has no `generate_outline` tool (planning happens in the conversation
 * and `create_stage` mints the stage), so that rail is not ported.
 */
export function deriveToolProgress(
  input: {
    toolName?: string;
    traces: string[];
    running: boolean;
    failed: boolean;
  },
  t: WorkbenchTranslator = defaultWorkbenchTranslator,
): ToolProgress | null {
  if (input.toolName === 'generate_scene') {
    return sceneProgress(input.traces, input.running, input.failed, t);
  }
  return null;
}
