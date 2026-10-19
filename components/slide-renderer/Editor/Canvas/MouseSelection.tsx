/**
 * 本文件：框选矩形（虚线选框）的展示组件。
 * 职责：接收 useMouseSelection 计算的几何状态，按拖拽象限修正原点
 *       并乘以画布缩放，输出绝对定位的虚线边框。
 * 关键点：象限 1-3 表示向左/向上拖拽，left/top 需减去宽高才能得到
 *       真正的左上角坐标。
 */

'use client';

export interface MouseSelectionProps {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly quadrant: number;
  readonly canvasScale: number;
}

/**
 * Mouse selection component
 * Displays selection rectangle during mouse drag selection
 *
 * 中文：框选矩形组件。拖拽框选时按当前象限（quadrant）修正左上角
 * 坐标（向左/向上拖时 width/height 为负方向），再乘 canvasScale
 * 换算为屏幕像素绘制虚线框。
 */
export function MouseSelection({
  top,
  left,
  width,
  height,
  quadrant,
  canvasScale,
}: MouseSelectionProps) {
  const selectionStyle = {
    left: `${(quadrant === 2 || quadrant === 3 ? left - width : left) * canvasScale}px`,
    top: `${(quadrant === 2 || quadrant === 1 ? top - height : top) * canvasScale}px`,
    width: `${width * canvasScale}px`,
    height: `${height * canvasScale}px`,
  };

  return (
    <div
      className="mouse-selection absolute border-2 border-primary border-dashed z-41"
      style={selectionStyle}
    />
  );
}
