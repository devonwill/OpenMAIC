/**
 * 本文件：时间轴动作选择器的选项生成。
 * 职责：按场景类型与现有动作列表，计算可添加的动作类型及其禁用态。
 * 关键点：元素绑定类提示（聚光/激光笔）仅在幻灯片场景提供；
 * 讨论动作至多一个且必须居末，已存在时禁用。
 */
import type { Action } from '@/lib/types/action';
import type { SceneType } from '@/lib/types/stage';
import { hasDiscussion } from './actions-edit';
import { ELEMENT_BOUND } from './cue-meta';

/** Addable cue types offered in the picker's "action" group (before discussion). */
const CUE_ORDER = ['speech', 'spotlight', 'laser'] as const;

export type PickerType = (typeof CUE_ORDER)[number] | 'discussion';
export interface PickerOption {
  type: PickerType;
  disabled: boolean;
}

/**
 * Element-bound cues (spotlight/laser) need a slide canvas to bind to, so they
 * are only offered on slide scenes — mirrors the old header-palette filter.
 * Discussion is terminal + at-most-one, so it is disabled when one exists.
 * 生成选择器选项：过滤场景不支持的类型，并标记已存在讨论的禁用态。
 */
export function pickerOptions(sceneType: SceneType, actions: Action[]): PickerOption[] {
  const cues = CUE_ORDER.filter((t) => sceneType === 'slide' || !ELEMENT_BOUND.has(t)).map(
    (type) => ({ type, disabled: false }),
  );
  return [...cues, { type: 'discussion' as const, disabled: hasDiscussion(actions) }];
}
