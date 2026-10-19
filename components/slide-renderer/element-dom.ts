/**
 * 本文件：渲染后元素在 DOM 中的寻址约定（ID 前缀与 data 属性）。
 * 职责：统一编辑器、屏幕渲染器定位元素 DOM 节点的方式。
 * 关键点：导出（PPTX/PDF）与截图定位也依赖这些约定，改动需同步。
 *
 * Element DOM contract — the one place that decides how a rendered slide
 * element is addressable from outside its own React tree.
 */
export const EDITABLE_ELEMENT_ID_PREFIX = 'editable-element-';
export const SCREEN_ELEMENT_ID_PREFIX = 'screen-element-';

/** Renderer-agnostic "this subtree paints element X" marker. */
export const MAIC_ELEMENT_ID_ATTRIBUTE = 'data-maic-element-id';

/** 生成编辑器内可编辑元素宿主节点的 DOM id。 */
export function editableElementDomId(elementId: string): string {
  return `${EDITABLE_ELEMENT_ID_PREFIX}${elementId}`;
}

/** 生成屏幕（放映）渲染层元素宿主节点的 DOM id。 */
export function screenElementDomId(elementId: string): string {
  return `${SCREEN_ELEMENT_ID_PREFIX}${elementId}`;
}

/** Spread onto an element host so the attribute name is written once. */
export function maicElementIdAttributes(elementId: string): Record<string, string> {
  return { [MAIC_ELEMENT_ID_ATTRIBUTE]: elementId };
}
