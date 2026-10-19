/**
 * 本文件：聚光灯（spotlight）特效覆盖层。
 * 职责：通过 DOM 实测目标元素位置，用 SVG mask 在整页暗层上
 *       挖出高亮区域并加白边，动画由 spotlightV1 描述符驱动。
 * 关键点：位置用 getBoundingClientRect 实测并归一到 0-100
 *       viewBox，避免百分比坐标换算的对齐偏移；暗层禁用
 *       backdrop-filter（与 SVG mask 合成冲突，见代码内注释）。
 */
'use client';

import { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { spotlightV1 } from '@/lib/choreography';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import { useCanvasStore } from '@/lib/store/canvas';
import type { SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@openmaic/dsl';
import { resolveMotionLayer } from './motion-descriptor-adapter';
import { SCREEN_ELEMENT_ID_PREFIX } from '../element-dom';

interface SpotlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Spotlight overlay component
 *
 * Uses DOM measurement (getBoundingClientRect) to compute spotlight position,
 * avoiding alignment offsets from percentage coordinate conversion.
 * 中文：用 DOM 实测计算聚光位置，避免百分比坐标换算带来的偏移。
 */
interface SpotlightOverlayProps {
  /**
   * DOM id prefix used to locate the target element. Playback screens render
   * elements as `screen-element-<id>` (default); the editor canvas renders
   * them as `editable-element-<id>` and passes that prefix so the exact same
   * spotlight effect plays in Pro mode.
   */
  domIdPrefix?: string;
}

/**
 * 聚光灯覆盖层：按目标元素 DOM 位置在暗层上挖洞高亮。
 * 中文：目标不存在或容器尺寸为 0 时清空 rect、不渲染特效。
 */
export function SpotlightOverlay({
  domIdPrefix = SCREEN_ELEMENT_ID_PREFIX,
}: SpotlightOverlayProps = {}) {
  const spotlightElementId = useCanvasStore.use.spotlightElementId();
  const spotlightOptions = useCanvasStore.use.spotlightOptions();
  const containerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  const elements = useSceneSelector<SlideContent, PPTElement[]>(
    (content) => content.canvas.elements,
  );

  // Compute target element position in SVG coordinate system via DOM measurement
  const measure = useCallback(() => {
    if (!spotlightElementId || !containerRef.current) {
      setRect(null);
      return;
    }

    const domElement = document.getElementById(`${domIdPrefix}${spotlightElementId}`);
    if (!domElement) {
      setRect(null);
      return;
    }

    // Prefer measuring .element-content (the actual rendered area for auto-height)
    const contentEl = domElement.querySelector('.element-content');
    const targetEl = contentEl ?? domElement;

    const containerRect = containerRef.current.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    if (containerRect.width === 0 || containerRect.height === 0) {
      setRect(null);
      return;
    }

    // Convert to SVG viewBox 0-100 coordinates
    // 中文：把实测像素差换算成容器内的相对百分比（0-100），
    //   与 SVG viewBox 口径一致，保证 mask 矩形与元素严格对齐
    setRect({
      x: ((targetRect.left - containerRect.left) / containerRect.width) * 100,
      y: ((targetRect.top - containerRect.top) / containerRect.height) * 100,
      w: (targetRect.width / containerRect.width) * 100,
      h: (targetRect.height / containerRect.height) * 100,
    });
  }, [spotlightElementId, domIdPrefix]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement requires effect
    measure();
  }, [measure, elements]);

  const active = !!spotlightElementId && !!spotlightOptions && !!rect;
  const resolvedLayers = rect
    ? {
        dim: resolveMotionLayer(spotlightV1, 'dim', {
          geometry: rect,
          params: { dimness: spotlightOptions?.dimness },
        }),
        cutout: resolveMotionLayer(spotlightV1, 'cutout', { geometry: rect }),
        border: resolveMotionLayer(spotlightV1, 'border', { geometry: rect }),
      }
    : null;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: spotlightV1.zIndex }}
    >
      <AnimatePresence mode="wait">
        {active && rect && resolvedLayers && (
          <motion.div
            key={`spotlight-${spotlightElementId}`}
            initial={resolvedLayers.dim.initial}
            animate={resolvedLayers.dim.animate}
            exit={resolvedLayers.dim.exit}
            transition={resolvedLayers.dim.transition}
            className="absolute inset-0"
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0"
            >
              <defs>
                <mask id={`mask-${spotlightElementId}`}>
                  {/* White background = show mask layer (dimmed) */}
                  <rect x="0" y="0" width="100" height="100" fill="white" />
                  {/* Black rectangle = hide mask layer (highlighted area / cutout) */}
                  <motion.rect
                    {...resolvedLayers.cutout.staticProps}
                    initial={resolvedLayers.cutout.initial}
                    animate={resolvedLayers.cutout.animate}
                    transition={resolvedLayers.cutout.transition}
                  />
                </mask>
              </defs>

              {/* Dimmed Background. No backdrop-filter: combined with SVG <mask>
                 it breaks compositing (backdrop bypasses the mask cutout) in some
                 browsers, leaving the focused area dimmed despite the cutout.
                 Tailwind 3 silently dropped `backdrop-blur-[1.5px]` on SVG via
                 --tw-* variables; Tailwind 4 emits the property directly and
                 surfaced the bug. */}
              <rect {...resolvedLayers.dim.staticProps} mask={`url(#mask-${spotlightElementId})`} />

              {/* THE ONE BORDER - white border */}
              <motion.rect
                {...resolvedLayers.border.staticProps}
                initial={resolvedLayers.border.initial}
                animate={resolvedLayers.border.animate}
                transition={resolvedLayers.border.transition}
              />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
