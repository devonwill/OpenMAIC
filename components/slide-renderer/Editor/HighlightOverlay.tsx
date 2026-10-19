/**
 * 本文件：元素高亮特效覆盖层。
 * 职责：在被高亮元素的位置叠加边框、发光与脉冲动画的覆盖 div，
 * 不修改元素本身属性，支持多元素同时高亮。
 * 关键点：line 元素无 height 属性需排除；覆盖层 pointer-events
 *       关闭且 zIndex 固定，不阻挡画布交互。
 */
'use client';

import { useMemo } from 'react';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import { useCanvasStore } from '@/lib/store/canvas';
import type { SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@openmaic/dsl';

/**
 * Highlight overlay component
 *
 * Features:
 * - Overlays highlight effects on top of elements
 * - Does not modify element properties
 * - Supports highlighting multiple elements simultaneously
 * - Supports animation effects (breathing, blinking, etc.)
 *
 * Implementation:
 * - Creates overlay divs at element positions
 * - Uses box-shadow for glow effects
 * - Uses CSS animation for animated effects
 * 中文：在元素位置创建覆盖层，box-shadow 做发光、CSS 动画做呼吸/闪烁。
 */
export function HighlightOverlay() {
  const highlightedElementIds = useCanvasStore.use.highlightedElementIds();
  const highlightOptions = useCanvasStore.use.highlightOptions();

  // Get the element list of the current scene
  const elements = useSceneSelector<SlideContent, PPTElement[]>(
    (content) => content.canvas.elements,
  );

  // Find all elements to highlight (exclude line elements as they have no height property)
  // 中文：过滤出需高亮的元素；line 元素没有 height，覆盖层无法定位故排除
  const highlightedElements = useMemo(() => {
    if (!highlightedElementIds.length) return [];
    return elements.filter((el) => highlightedElementIds.includes(el.id) && el.type !== 'line');
  }, [elements, highlightedElementIds]);

  // Skip rendering if no highlighted elements
  if (!highlightedElements.length || !highlightOptions) {
    return null;
  }

  const { color = '#ff6b6b', opacity = 0.3, borderWidth = 3, animated = true } = highlightOptions;

  return (
    <>
      {highlightedElements.map((element) => {
        // Type guard: line elements are already filtered out above
        // Use 'in' operator for runtime checks to satisfy TypeScript
        const height = 'height' in element ? element.height : 0;
        const rotate = 'rotate' in element ? element.rotate : 0;
        return (
          <div
            key={element.id}
            className="highlight-overlay absolute pointer-events-none"
            style={{
              left: `${element.left}px`,
              top: `${element.top}px`,
              width: `${element.width}px`,
              height: `${height}px`,
              transform: `rotate(${rotate || 0}deg)`,
              transformOrigin: 'center',
              zIndex: 999,
              transition: 'all 0.3s ease-in-out',
            }}
          >
            {/* Highlight border */}
            <div
              className={`absolute inset-0 rounded ${animated ? 'animate-pulse' : ''}`}
              style={{
                border: `${borderWidth}px solid ${color}`,
                boxShadow: `
                0 0 ${borderWidth * 3}px ${color},
                inset 0 0 ${borderWidth * 2}px rgba(255,255,255,${opacity * 0.5})
              `,
                backgroundColor: `${color}${Math.round(opacity * 255)
                  .toString(16)
                  .padStart(2, '0')}`,
              }}
            />

            {/* Glow effect */}
            {animated && (
              <div
                className="absolute inset-0 rounded animate-ping"
                style={{
                  border: `${borderWidth}px solid ${color}`,
                  opacity: 0.5,
                  animationDuration: '2s',
                }}
              />
            )}
          </div>
        );
      })}

      {/* CSS animation (breathing light effect) */}
      <style jsx>{`
        @keyframes breathe {
          0%,
          100% {
            opacity: 0.6;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.02);
          }
        }

        .highlight-overlay.animate-pulse {
          animation: breathe 2s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}
