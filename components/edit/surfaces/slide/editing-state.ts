/**
 * 本文件：幻灯片选中态与编辑态解析的纯函数。
 * 职责：resolveSelectedElement 解析"唯一选中元素"，resolveEditingElementId
 * 决定画布 store 的 editingElementId（文本选中即进入编辑态）。
 * 关键点：仅"恰好选中一个"才生效；锁定（lock）元素拒绝进入编辑态；
 * requestedId 与实际选中不一致时回退为 ''，避免编辑错对象。
 */
import type { PPTElement } from '@openmaic/dsl';

/**
 * 解析当前唯一选中的幻灯片元素；选中数不为 1 或元素不在内容中时返回 undefined。
 * 中文要点：它是锚定工具条（文本格式条、图片操作条）的定位与显隐依据。
 *
 * The single selected slide element — `undefined` unless exactly one element is
 * selected and it resolves in the content. The basis for the surface's
 * selection-anchored chrome (the text format bar, the image action bar).
 */
export function resolveSelectedElement(
  activeElementIdList: readonly string[],
  elements: readonly PPTElement[],
): PPTElement | undefined {
  if (activeElementIdList.length !== 1) return undefined;
  return elements.find((el) => el.id === activeElementIdList[0]);
}

/**
 * The slide surface's text-editing policy: a single selected text element is,
 * by definition, the element being edited (there is no separate
 * "selected-not-editing" state for text). Anything else resolves to "".
 *
 * This is the value the surface writes into the canvas store's
 * `editingElementId`, which the renderer's `TextElementOperate` reads to swap
 * its dashed select frame for a clean solid editing frame.
 *
 * 中文要点：无 requestedId 时，"文本类且被选中"即视为正在编辑；有 requestedId
 * 时额外要求未锁定且与选中一致，否则返回 ''（取消编辑态）。
 */
export function resolveEditingElementId(
  activeElementIdList: readonly string[],
  elements: readonly PPTElement[],
  requestedId?: string,
  editableTypes: readonly PPTElement['type'][] = ['text'],
): string {
  const el = resolveSelectedElement(activeElementIdList, elements);
  const editable = Boolean(el && editableTypes.includes(el.type));
  if (requestedId === undefined) return editable ? (el?.id ?? '') : '';
  return editable && !el?.lock && el?.id === requestedId ? requestedId : '';
}
