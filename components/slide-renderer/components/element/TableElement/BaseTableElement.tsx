/**
 * 本文件：幻灯片表格元素的渲染组件（只读/回放/缩略图态）。
 * 职责：定位、旋转并渲染静态表格，不可交互。
 * 关键点：target 为 thumbnail 时关闭 pointer-events，
 *       避免缩略图上的表格抢占指针事件。
 */
'use client';

import type { PPTTableElement } from '@openmaic/dsl';
import { StaticTable } from './StaticTable';

export interface BaseTableElementProps {
  elementInfo: PPTTableElement;
  target?: string;
}

/**
 * Base table element for read-only / playback / thumbnail mode
 * 中文：只读态表格组件；缩略图场景禁用指针事件。
 */
export function BaseTableElement({ elementInfo, target }: BaseTableElementProps) {
  return (
    <div
      className={`base-element-table absolute ${target === 'thumbnail' ? 'pointer-events-none' : ''}`}
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
        <div className="element-content w-full h-full">
          <StaticTable elementInfo={elementInfo} />
        </div>
      </div>
    </div>
  );
}
