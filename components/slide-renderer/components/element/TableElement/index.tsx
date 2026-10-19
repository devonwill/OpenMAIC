/**
 * 本文件：幻灯片表格元素的渲染组件（编辑态）。
 * 职责：定位、旋转表格并渲染静态表格内容，处理点选与锁定状态。
 * 关键点：暂不支持单元格编辑，仅展示（与 ChartElement 同模式）；
 *       单元格合并的隐藏逻辑见 tableUtils.getHiddenCells。
 */
'use client';

import type { PPTTableElement } from '@openmaic/dsl';
import { StaticTable } from './StaticTable';

export { BaseTableElement } from './BaseTableElement';

export interface TableElementProps {
  elementInfo: PPTTableElement;
  selectElement?: (e: React.MouseEvent | React.TouchEvent, element: PPTTableElement) => void;
}

/**
 * Editable table element component.
 * Supports selection/drag/resize via selectElement callback.
 * Cell editing is not implemented yet (display-only, matching ChartElement pattern).
 * 中文：编辑态表格组件；锁定时点选不冒泡到白板。
 */
export function TableElement({ elementInfo, selectElement }: TableElementProps) {
  const handleSelectElement = (e: React.MouseEvent | React.TouchEvent) => {
    if (elementInfo.lock) return;
    e.stopPropagation();
    selectElement?.(e, elementInfo);
  };

  return (
    <div
      className={`editable-element-table absolute ${elementInfo.lock ? 'lock' : ''}`}
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
          className={`element-content relative w-full h-full overflow-hidden ${
            elementInfo.lock ? 'cursor-default' : 'cursor-move'
          }`}
          onMouseDown={handleSelectElement}
          onTouchStart={handleSelectElement}
        >
          <StaticTable elementInfo={elementInfo} />
        </div>
      </div>
    </div>
  );
}
