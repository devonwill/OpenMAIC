/**
 * 本文件：表格行列数选择网格。
 * 职责：6×8 网格 hover/focus 预览行列尺寸，点击确认后回调 onPick(rows, columns)。
 * 关键点：active 高亮按"左上矩形"规则（rows/columns 均不大于当前 size）；
 * onMouseEnter 与 onFocus 同步 size，兼顾鼠标与键盘操作。
 */
'use client';

import { useState } from 'react';

const MAX_ROWS = 6;
const MAX_COLUMNS = 8;

interface TableInsertPickerProps {
  readonly onPick: (rows: number, columns: number) => void;
  readonly getLabel: (rows: number, columns: number) => string;
}

/**
 * Grid picker for choosing a new table's row and column count.
 * 中文要点：网格尺寸由 MAX_ROWS/MAX_COLUMNS 常量决定，label 文案由外部
 * getLabel 提供（组件本身不依赖 i18n）。
 */
export function TableInsertPicker({ onPick, getLabel }: TableInsertPickerProps) {
  const [size, setSize] = useState({ rows: 1, columns: 1 });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-8 gap-1" role="grid">
        {Array.from({ length: MAX_ROWS }, (_, rowIndex) =>
          Array.from({ length: MAX_COLUMNS }, (_, columnIndex) => {
            const rows = rowIndex + 1;
            const columns = columnIndex + 1;
            const active = rows <= size.rows && columns <= size.columns;
            const label = getLabel(rows, columns);

            return (
              <button
                key={`${rows}-${columns}`}
                type="button"
                aria-label={label}
                data-table-insert-cell=""
                data-active={active || undefined}
                onMouseEnter={() => setSize({ rows, columns })}
                onFocus={() => setSize({ rows, columns })}
                onClick={() => onPick(rows, columns)}
                className={
                  active
                    ? 'aspect-square rounded-sm border border-blue-500 bg-blue-500'
                    : 'aspect-square rounded-sm border border-zinc-300 bg-white hover:border-blue-400 hover:bg-blue-100 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-blue-400 dark:hover:bg-blue-500/20'
                }
              />
            );
          }),
        )}
      </div>
      <div
        data-testid="table-insert-dimensions"
        className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-200"
      >
        {getLabel(size.rows, size.columns)}
      </div>
    </div>
  );
}
