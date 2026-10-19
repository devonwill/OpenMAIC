/**
 * 本文件：面板接缝处的拖拽调宽把手。
 * 职责：6px 抓取条，拖动实时预览宽度、松手提交、双击复位。
 * 关键点：把手不再承载折叠（折叠已移入各面板头部）；活跃态读自身
 * data-ws-drag 而非全局 data-ws-resizing，避免同页多个接缝同时点亮；
 * 指针捕获保证快速拖动不丢跟踪，按下未移动不算调整。
 */
'use client';

/**
 * The seam between two panes: a resize control, and only that.
 *
 * A 6px grab strip straddling a pane's edge. Hover strengthens its hairline;
 * dragging moves the seam, double-clicking the rule resets the width.
 *
 * It carries NO fold button any more. A seam sits between two collapsible panes,
 * so a fold on it can only ever speak for one of them — and when both got one,
 * the seam's midpoint grew two mutually-reversed chevrons two centimetres from a
 * third (the slide navigator's own fold, at the classroom's left edge). Three
 * chevrons at one height, none of which says which panel it means, is a puzzle.
 * Folding a pane now lives in that pane's own header (`PaneFoldButton`), where
 * there is exactly one of them and it is attached to the thing it folds.
 *
 * The navigation rail was the last exception and is not one any more: it folds
 * from its own header row (the wordmark and the PRO pill) like the other two, so
 * this handle no longer looks for a collapse grip beside it and a press released
 * without moving does nothing. Every seam on the surface now means exactly one
 * thing.
 *
 * The active state is keyed off `data-ws-drag` ON THIS HANDLE rather than the
 * document flag: `data-ws-resizing` is shared by every seam on the page, and
 * lighting all of them while one is moving misreports what is happening.
 *
 * The pointer is CAPTURED, so a fast drag that outruns the cursor still
 * tracks; `data-ws-resizing` on the document element is what stops the cursor
 * flickering and text selecting as the pointer travels over other elements.
 */

import { useRef } from 'react';
import { cn } from '@/lib/utils/cn';

// 预览态只改内存中的 latest，松手才 commit，避免拖动期间反复写布局。
export function ResizeHandle({
  testId,
  label,
  edge,
  current,
  clamp,
  onPreview,
  onCommit,
  onReset,
}: {
  readonly testId: string;
  readonly label: string;
  /** Which edge of the pane the strip sits on. */
  readonly edge: 'left' | 'right';
  readonly current: () => number;
  readonly clamp: (width: number) => number;
  readonly onPreview: (width: number) => void;
  readonly onCommit: (width: number) => void;
  readonly onReset: () => void;
}) {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    latest: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Ignore secondary buttons: a right-click drag is not a resize.
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.setAttribute('data-ws-drag', 'true');
    const start = current();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: start,
      latest: start,
      moved: false,
    };
    document.documentElement.setAttribute('data-ws-resizing', 'true');
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 3) {
      // 3px 阈值区分「点击」与「拖拽」，微抖动不触发调整。
      drag.moved = true;
    }
    // 左右边缘的位移方向相反：右缘向右拖变宽，左缘向左拖变宽。
    const delta = edge === 'right' ? event.clientX - drag.startX : drag.startX - event.clientX;
    drag.latest = clamp(drag.startWidth + delta);
    onPreview(drag.latest);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    event.currentTarget.removeAttribute('data-ws-drag');
    document.documentElement.removeAttribute('data-ws-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A press that never moved is not a resize, and it is no longer a fold
    // either: nothing on a seam collapses anything.
    if (drag.moved) onCommit(drag.latest);
  };

  return (
    <div
      data-testid={testId}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      className={cn(
        'ws-resize absolute inset-y-0 z-20 w-1.5 cursor-col-resize',
        edge === 'right' ? 'right-0 translate-x-1/2' : 'left-0 -translate-x-1/2',
      )}
    >
      <span className="ws-resize-thread" aria-hidden="true" />
    </div>
  );
}
