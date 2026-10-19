/**
 * 本文件：激光笔指针的实测定位覆盖层（编辑画布版）。
 * 职责：读取 canvas store 的 laserElementId/laserOptions，用
 *       getBoundingClientRect 实测目标元素中心，换算为容器百分比坐标，
 *       交给 LaserOverlay 播放激光点动画。
 * 关键点：编辑画布原本没有激光渲染面，缺此层时 laser 提示会被降级为
 *       聚光灯；容器不设 overflow-hidden，激光可从画外飞入。
 */

'use client';

import { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import { useCanvasStore } from '@/lib/store/canvas';
import type { SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@openmaic/dsl';
import { LaserOverlay } from './LaserOverlay';
import { SCREEN_ELEMENT_ID_PREFIX } from '../element-dom';

interface LaserPointerOverlayProps {
  /**
   * DOM id prefix used to locate the target element. Playback screens render
   * elements as `screen-element-<id>` (default); the editor canvas renders
   * them as `editable-element-<id>` and passes that prefix so a `laser` cue
   * replays as the real laser pointer in Pro mode.
   */
  domIdPrefix?: string;
}

/**
 * Store-driven laser pointer overlay.
 *
 * The laser sibling of {@link SpotlightOverlay}: reads `laserElementId` /
 * `laserOptions` from the canvas store and measures the rendered DOM element
 * (`getBoundingClientRect`) to place the laser dot at its center. Without this,
 * the edit canvas had no laser surface, so laser cues had nowhere to render and
 * were collapsed into a spotlight instead.
 *
 * 中文：store 驱动的激光笔覆盖层，是 SpotlightOverlay 的激光兄弟组件；
 * 通过实测 DOM 元素位置把激光点放到目标中心，让编辑画布也具备激光渲染面。
 */
export function LaserPointerOverlay({
  domIdPrefix = SCREEN_ELEMENT_ID_PREFIX,
}: LaserPointerOverlayProps = {}) {
  const laserElementId = useCanvasStore.use.laserElementId();
  const laserOptions = useCanvasStore.use.laserOptions();
  const containerRef = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);

  const elements = useSceneSelector<SlideContent, PPTElement[]>(
    (content) => content.canvas.elements,
  );

  // Compute the target element center as a percentage of the overlay container.
  const measure = useCallback(() => {
    if (!laserElementId || !containerRef.current) {
      setCenter(null);
      return;
    }

    const domElement = document.getElementById(`${domIdPrefix}${laserElementId}`);
    if (!domElement) {
      setCenter(null);
      return;
    }

    // Prefer .element-content (the actual rendered area for auto-height).
    const contentEl = domElement.querySelector('.element-content');
    const targetEl = contentEl ?? domElement;

    const containerRect = containerRef.current.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    if (containerRect.width === 0 || containerRect.height === 0) {
      setCenter(null);
      return;
    }

    setCenter({
      x:
        ((targetRect.left + targetRect.width / 2 - containerRect.left) / containerRect.width) * 100,
      y:
        ((targetRect.top + targetRect.height / 2 - containerRect.top) / containerRect.height) * 100,
    });
  }, [laserElementId, domIdPrefix]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement requires effect
    measure();
  }, [measure, elements]);

  return (
    // No overflow-hidden: the laser flies in from just outside the frame.
    <div ref={containerRef} className="absolute inset-0 z-[101] pointer-events-none">
      <AnimatePresence>
        {laserElementId && center && (
          <LaserOverlay
            key={`laser-${laserElementId}`}
            geometry={{ x: 0, y: 0, w: 0, h: 0, centerX: center.x, centerY: center.y }}
            color={laserOptions?.color}
            duration={laserOptions?.duration}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
