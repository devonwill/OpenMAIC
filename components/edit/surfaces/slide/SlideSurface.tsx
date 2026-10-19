/**
 * 本文件：slide surface 的定义与对外导出。
 * 职责：把场景类型 'slide' 与画布组件 SlideCanvas、状态钩子
 * useSlideSurfaceState 绑定为一个 SceneEditorSurface 注册项。
 */
import type { SceneEditorSurface } from '@/lib/edit/scene-editor-surface';
import type { SlideContent } from '@/lib/types/stage';
import { SlideCanvas } from './SlideCanvas';
import { useSlideSurfaceState, type SlideSelection } from './use-slide-surface';

/**
 * The slide SceneEditorSurface. EditShell resolves this by scene type and
 * renders `SurfaceComponent` + reads `useSurfaceState()` into the command
 * bar / floating toolbar. The registered surface supplies the current text,
 * insert, image, z-order, geometry, and slide-management commands.
 *
 * 中文要点：这是 EditShell 解析 'slide' 类型得到的注册对象，
 * 顶栏与浮动工具条的命令全部来自 useSurfaceState。
 */
export const slideSurface: SceneEditorSurface<SlideContent, SlideSelection> = {
  sceneType: 'slide',
  SurfaceComponent: SlideCanvas,
  useSurfaceState: useSlideSurfaceState,
};
