/**
 * 本文件：幻灯片编辑器的顶层入口组件。
 * 职责：按舞台模式（mode）在自主编辑 Canvas 与回放画布
 *       PlaybackScreenCanvas 之间切换渲染。
 * 关键点：模式判断集中在这一处，下游画布无需感知对方存在。
 */
'use client';

import Canvas from './Canvas';
import type { StageMode } from '@/lib/types/stage';
import { PlaybackScreenCanvas } from './ScreenCanvas';

/**
 * Slide Editor - wraps Canvas with SceneProvider
 * 中文：编辑器入口；autonomous 模式用可编辑 Canvas，其余用回放画布。
 */
export function SlideEditor({ mode }: { readonly mode: StageMode }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        {mode === 'autonomous' ? <Canvas /> : <PlaybackScreenCanvas />}
      </div>
    </div>
  );
}
