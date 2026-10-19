/**
 * 本文件：幻灯片渲染器 DOM 契约的转发模块。
 * 职责：从 slide-renderer/element-dom 重导出元素 id 前缀与属性常量，
 * 供编辑层定位/命中渲染出的元素 DOM。
 */
/** Re-export the DOM contract emitted by the slide renderer. */
export {
  EDITABLE_ELEMENT_ID_PREFIX,
  MAIC_ELEMENT_ID_ATTRIBUTE,
  SCREEN_ELEMENT_ID_PREFIX,
  editableElementDomId,
  maicElementIdAttributes,
  screenElementDomId,
} from '@/components/slide-renderer/element-dom';
