/**
 * 本文件：幻灯片 LaTeX 公式元素的渲染组件（编辑态）。
 * 职责：按元素数据定位与旋转，优先渲染 KaTeX HTML，
 *       无 HTML 时回退到历史 SVG path 方案，支持点选。
 * 关键点：KaTeX 内容为自然尺寸，需按元素宽高做等比 scale 适配，
 *       见 KatexContent 中的 min(width/naturalW, height/naturalH)。
 */
'use client';

import { useRef, useState, useLayoutEffect } from 'react';
import type { PPTLatexElement } from '@openmaic/dsl';

export { BaseLatexElement } from './BaseLatexElement';

export interface LatexElementProps {
  elementInfo: PPTLatexElement;
  selectElement?: (e: React.MouseEvent | React.TouchEvent, element: PPTLatexElement) => void;
}

/**
 * Latex element component (editable mode).
 * Renders KaTeX HTML if available, falls back to legacy SVG path.
 * 中文：编辑态公式组件；锁定元素不触发点选。
 */
export function LatexElement({ elementInfo, selectElement }: LatexElementProps) {
  const handleSelectElement = (e: React.MouseEvent | React.TouchEvent) => {
    if (elementInfo.lock) return;
    e.stopPropagation();
    selectElement?.(e, elementInfo);
  };

  return (
    <div
      className={`editable-element-latex absolute ${elementInfo.lock ? 'lock' : ''}`}
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
      }}
    >
      <div
        className="rotate-wrapper w-full h-full"
        style={{ transform: `rotate(${elementInfo.rotate}deg)` }}
      >
        <div
          className={`element-content relative w-full h-full ${
            elementInfo.lock ? 'cursor-default' : 'cursor-move'
          }`}
          style={{ color: elementInfo.color }}
          onMouseDown={handleSelectElement}
          onTouchStart={handleSelectElement}
        >
          {elementInfo.html ? (
            <KatexContent
              html={elementInfo.html}
              width={elementInfo.width}
              height={elementInfo.height}
            />
          ) : elementInfo.path && elementInfo.viewBox ? (
            <svg
              overflow="visible"
              width={elementInfo.width}
              height={elementInfo.height}
              stroke={elementInfo.color}
              strokeWidth={elementInfo.strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transform-origin-[0_0]"
            >
              <g
                transform={`scale(${elementInfo.width / elementInfo.viewBox[0]}, ${
                  elementInfo.height / elementInfo.viewBox[1]
                }) translate(0,0) matrix(1,0,0,1,0,0)`}
              >
                <path d={elementInfo.path} />
              </g>
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function KatexContent({ html, width, height }: { html: string; width: number; height: number }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (!innerRef.current) return;
    const naturalW = innerRef.current.scrollWidth;
    const naturalH = innerRef.current.scrollHeight;
    // 取宽、高两个方向缩放比的较小值做等比缩放，保证公式不变形；除零时保持 1
    if (naturalW > 0 && naturalH > 0) {
      setScale(Math.min(width / naturalW, height / naturalH));
    }
  }, [html, width, height]);

  return (
    <div style={{ width, height, overflow: 'hidden' }}>
      <div
        ref={innerRef}
        className="[&_.katex-display]:!m-0"
        style={{
          transformOrigin: '0 0',
          transform: `scale(${scale})`,
          whiteSpace: 'nowrap',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
