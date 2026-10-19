/**
 * 本文件：旁白时间轴（ActionsBar）的场景类型可用性判断。
 * 职责：判断当前场景是否应展示旁白时间轴——已注册编辑面的场景，
 * 或虽只读但仍携带旁白脚本的场景（interactive/pbl）。
 * 关键点：时间轴与画布编辑面解耦，且作为 EditDock 的挂载闸门。
 */

import type { SceneType } from '@/lib/types/stage';

/**
 * The narration timeline (ActionsBar) is decoupled from the canvas editor
 * surface. It applies wherever a spoken script makes sense: scene types with a
 * registered editor surface (slide/quiz), PLUS view-only-canvas scenes that
 * still carry narration (interactive/pbl).
 */
const NARRATION_ONLY_TYPES: ReadonlySet<SceneType> = new Set(['interactive', 'pbl']);

/** 场景是否支持旁白时间轴：有已注册编辑面，或属于旁白专用类型。 */
export function supportsNarrationTimeline(
  sceneType: SceneType,
  hasRegisteredSurface: boolean,
): boolean {
  return hasRegisteredSurface || NARRATION_ONLY_TYPES.has(sceneType);
}
