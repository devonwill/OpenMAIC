/**
 * 本文件：幻灯片编辑画布容器（新旧渲染器切换入口）。
 * 职责：按 feature flag 在旧编辑器 Canvas 与 RendererEditorCanvas 间切换，
 * 统一挂载聚光/激光笔覆盖层、锚定工具条、元素引用图钉层与拾取层。
 * 关键点：legacy 模式下 useSyncEditingElementId 把解析后的编辑态写回 canvas store；
 * 全局 Escape 监听用于取消"正在创建元素"的拖拽状态。
 */
'use client';

import { useEffect } from 'react';
import Canvas from '@/components/slide-renderer/Editor/Canvas';
import { SpotlightOverlay } from '@/components/slide-renderer/Editor/SpotlightOverlay';
import { LaserPointerOverlay } from '@/components/slide-renderer/Editor/LaserPointerOverlay';
import { SceneProvider } from '@/lib/contexts/scene-context';
import { isEditorRendererEnabled } from '@/lib/config/feature-flags';
import { useCanvasStore } from '@/lib/store/canvas';
import { AnchoredTextBar } from './AnchoredTextBar';
import { AnchoredElementBar } from './AnchoredElementBar';
import { ElementPickLayer } from './ElementPickLayer';
import { ElementRefPinLayer } from './ElementRefPinLayer';
import { EDITABLE_ELEMENT_ID_PREFIX } from './renderer-element-dom';
import {
  useEditingTextElementId,
  useSelectedNonTextElement,
  useSlideCanvasController,
  useSyncEditingElementId,
} from './use-slide-surface';
import { RendererEditorCanvas } from './RendererEditorCanvas';

/**
 * Switches between the preserved legacy editor and the renderer editor.
 * 中文要点：锚定工具条只在 legacy 分支挂载（新渲染器自带等价交互）；
 * 选区/编辑态统一来自 use-slide-surface 的选择器 hooks。
 */
export function SlideCanvas() {
  const { controller, gestureProps } = useSlideCanvasController();
  const useRendererEditor = isEditorRendererEnabled();
  const requestedEditingElementId = useCanvasStore.use.editingElementId();
  const editingElementId = useEditingTextElementId(
    useRendererEditor ? requestedEditingElementId : undefined,
  );
  const nonTextElement = useSelectedNonTextElement();
  useSyncEditingElementId(editingElementId, !useRendererEditor);

  useEffect(() => {
    // Escape 只处理"取消创建中元素"，不冒泡到上层，避免与其他快捷键抢事件
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const canvas = useCanvasStore.getState();
      if (canvas.creatingElement) canvas.setCreatingElement(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="relative h-full w-full" {...gestureProps}>
      <SceneProvider controller={controller}>
        {useRendererEditor ? <RendererEditorCanvas /> : <Canvas />}
        <SpotlightOverlay domIdPrefix={EDITABLE_ELEMENT_ID_PREFIX} />
        <LaserPointerOverlay domIdPrefix={EDITABLE_ELEMENT_ID_PREFIX} />
      </SceneProvider>
      {!useRendererEditor && <AnchoredTextBar editingElementId={editingElementId} />}
      {!useRendererEditor && <AnchoredElementBar element={nonTextElement} />}
      <ElementRefPinLayer />
      <ElementPickLayer />
    </div>
  );
}
