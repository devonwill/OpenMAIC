/**
 * 本文件：表格渲染的纯工具函数。
 * 职责：单元格文字样式转 CSS、文本换行/空格转 HTML 实体，
 *       以及按 colspan/rowspan 合并结果计算需隐藏的单元格。
 * 关键点：合并单元格占用的位置需跳过，否则表格列会错位。
 */
import type { CSSProperties } from 'react';
import type { TableCell, TableCellStyle } from '@openmaic/dsl';

/**
 * Convert TableCellStyle to CSS properties
 * 中文：把 DSL 的表格文字样式映射为 CSS 属性；下划线与删除线
 *       需合并进同一个 textDecoration。
 */
export function getTextStyle(style?: TableCellStyle): CSSProperties {
  if (!style) return {};

  const css: CSSProperties = {};

  if (style.bold) css.fontWeight = 'bold';
  if (style.em) css.fontStyle = 'italic';
  if (style.underline) css.textDecoration = 'underline';
  if (style.strikethrough) {
    css.textDecoration = css.textDecoration ? `${css.textDecoration} line-through` : 'line-through';
  }
  if (style.color) css.color = style.color;
  if (style.backcolor) css.backgroundColor = style.backcolor;
  if (style.fontsize) css.fontSize = style.fontsize;
  if (style.fontname) css.fontFamily = style.fontname;
  if (style.align) css.textAlign = style.align;

  return css;
}

/**
 * Format text: convert \n to <br/> and spaces to &nbsp;
 */
export function formatText(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.replace(/\n/g, '<br/>').replace(/ /g, '&nbsp;');
}

/**
 * Compute hidden cell positions based on colspan/rowspan merges.
 * Returns a Set of "row_col" keys for cells that should be hidden.
 * 中文：返回被合并覆盖的单元格坐标集合（渲染时跳过）；
 *       列索引用 realColIdx 而非 colIdx，以跨过已被占用的位置。
 */
export function getHiddenCells(data: TableCell[][]): Set<string> {
  const hidden = new Set<string>();

  for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    if (!Array.isArray(row)) continue;

    let realColIdx = 0;
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      // Skip positions already occupied by a previous merge
      while (hidden.has(`${rowIdx}_${realColIdx}`)) {
        realColIdx++;
      }

      const cell = row[colIdx];
      const colspan = Number.isFinite(cell?.colspan) && cell.colspan > 0 ? cell.colspan : 1;
      const rowspan = Number.isFinite(cell?.rowspan) && cell.rowspan > 0 ? cell.rowspan : 1;

      if (colspan > 1 || rowspan > 1) {
        for (let r = 0; r < rowspan; r++) {
          for (let c = 0; c < colspan; c++) {
            if (r === 0 && c === 0) continue;
            hidden.add(`${rowIdx + r}_${realColIdx + c}`);
          }
        }
      }

      realColIdx += colspan;
    }
  }

  return hidden;
}
