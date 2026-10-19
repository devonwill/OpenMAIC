/**
 * 本文件：只读/回放态单个元素的渲染分发组件。
 * 职责：按元素类型查表选择对应的 Base* 渲染组件，套上
 *       层级、主题字体色与 DOM id 标识后渲染。
 * 关键点：类型映射用 useMemo 按 elementInfo.type 记忆化；
 *       未知类型返回 null 而非报错，容忍旧数据。
 */
'use client';

import { ElementTypes, type PPTElement } from '@openmaic/dsl';
import { useMemo } from 'react';

import { BaseImageElement } from '../components/element/ImageElement/BaseImageElement';
import { BaseTextElement } from '../components/element/TextElement/BaseTextElement';
import { BaseShapeElement } from '../components/element/ShapeElement/BaseShapeElement';
import { BaseLineElement } from '../components/element/LineElement/BaseLineElement';
import { BaseChartElement } from '../components/element/ChartElement/BaseChartElement';
import { BaseLatexElement } from '../components/element/LatexElement/BaseLatexElement';
import { BaseTableElement } from '../components/element/TableElement/BaseTableElement';
import { BaseVideoElement } from '../components/element/VideoElement/BaseVideoElement';
import { BaseCodeElement } from '../components/element/CodeElement/BaseCodeElement';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import type { SceneContent } from '@/lib/types/stage';
import { maicElementIdAttributes, screenElementDomId } from '../element-dom';

interface ScreenElementProps {
  readonly elementInfo: PPTElement;
  readonly elementIndex: number;
  readonly animate?: boolean;
}

/**
 * 屏幕元素分发：根据元素类型选择只读渲染组件。
 * 中文：未注册的类型直接不渲染（返回 null）。
 */
export function ScreenElement({ elementInfo, elementIndex, animate }: ScreenElementProps) {
  const CurrentElementComponent = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- element components have varying prop signatures
    const elementTypeMap: Record<string, any> = {
      [ElementTypes.IMAGE]: BaseImageElement,
      [ElementTypes.TEXT]: BaseTextElement,
      [ElementTypes.SHAPE]: BaseShapeElement,
      [ElementTypes.LINE]: BaseLineElement,
      [ElementTypes.CHART]: BaseChartElement,
      [ElementTypes.LATEX]: BaseLatexElement,
      [ElementTypes.TABLE]: BaseTableElement,
      [ElementTypes.VIDEO]: BaseVideoElement,
      [ElementTypes.CODE]: BaseCodeElement,
      // TODO: Add other element types
      // [ElementTypes.AUDIO]: BaseAudioElement,
    };
    return elementTypeMap[elementInfo.type] || null;
  }, [elementInfo.type]);

  const theme = useSceneSelector<SceneContent, { fontColor: string; fontName: string }>(
    (content) => {
      if (content.type === 'slide') {
        return content.canvas.theme;
      }
      return {
        fontColor: '#333333',
        fontName: 'Microsoft YaHei',
      };
    },
  );

  if (!CurrentElementComponent) {
    return null;
  }

  return (
    <div
      className="screen-element"
      id={screenElementDomId(elementInfo.id)}
      {...maicElementIdAttributes(elementInfo.id)}
      style={{
        zIndex: elementIndex,
        color: theme.fontColor,
        fontFamily: theme.fontName,
      }}
    >
      <CurrentElementComponent elementInfo={elementInfo} animate={animate} />
    </div>
  );
}
