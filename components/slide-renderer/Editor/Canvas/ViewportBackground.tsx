/**
 * 本文件：视口背景（幻灯片底板）的渲染组件。
 * 职责：从 Scene Context 订阅当前页背景数据，经统一 hook 转为 CSS
 *       背景样式（纯色/图片/渐变），铺满视口且不拦截鼠标事件。
 * 关键点：pointer-events: none 保证背景不参与命中测试，点击穿透到
 *       画布空白区处理逻辑。
 */

'use client';

import { useSceneSelector } from '@/lib/contexts/scene-context';
import { useSlideBackgroundStyle } from '@/lib/hooks/use-slide-background-style';
import type { SlideContent } from '@/lib/types/stage';
import type { SlideBackground } from '@openmaic/dsl';

/**
 * Viewport background component using Scene Context
 * Renders the slide background from current scene data
 *
 * 中文：基于 Scene Context 的视口背景组件，只订阅 background 字段
 * 以减少无关重渲染，铺满视口并保持 pointer-events: none。
 */
export function ViewportBackground() {
  // Subscribe only to background for performance
  const background = useSceneSelector<SlideContent, SlideBackground | undefined>(
    (content) => content.canvas.background,
  );

  const { backgroundStyle: bgStyle } = useSlideBackgroundStyle(background);

  const backgroundStyle: React.CSSProperties = {
    ...bgStyle,
    width: '100%',
    height: '100%',
    backgroundPosition: 'center',
    position: 'absolute',
    pointerEvents: 'none', // Don't block mouse events
  };

  return <div className="viewport-background" style={backgroundStyle} />;
}
