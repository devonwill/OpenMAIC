/**
 * 本文件：线条预设插入面板。
 * 职责：把 DSL 线条库（LINE_LIST）拍平成 5 列网格按钮，
 * 点击回调 onPick 交由上层插入画布。
 * 关键点：getPresetLabel 按几何特征（曲线/折线/箭头/虚线）生成中文可访问名称，
 * aria-label 与 tooltip 复用该标签。
 */
'use client';

import { LINE_LIST, type LinePoolItem } from '@/configs/lines';

interface LinePresetPickerProps {
  readonly onPick: (preset: LinePoolItem) => void;
}

function getPresetLabel(preset: LinePoolItem) {
  if (preset.isCubic) return '三次曲线';
  if (preset.isCurve) return '曲线';
  if (preset.isBroken2) return '双折线';
  if (preset.isBroken) return '折线';
  if (preset.points[1] === 'arrow') return '箭头直线';
  if (preset.points[1] === 'dot') return '圆点直线';
  return preset.style === 'dashed' ? '虚线' : '直线';
}

/**
 * Renderer-editor insert palette for the existing DSL line presets.
 * 中文要点：纯展示组件，不持有状态；key 用 path+index 是因为不同分组可能复用同一路径。
 */
export function LinePresetPicker({ onPick }: LinePresetPickerProps) {
  return (
    <div className="grid grid-cols-5 gap-2" role="group" aria-label="线条预设">
      {LINE_LIST.flatMap((group) => group.children).map((preset, index) => {
        const label = getPresetLabel(preset);
        return (
          <button
            key={`${preset.path}-${index}`}
            type="button"
            aria-label={label}
            className="flex aspect-square items-center justify-center rounded-md border border-transparent p-2 text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:text-zinc-300 dark:hover:border-blue-500/50 dark:hover:bg-blue-500/10"
            onClick={() => onPick(preset)}
          >
            <svg viewBox="0 0 20 20" className="h-7 w-7" aria-hidden="true">
              <path
                d={preset.path}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={preset.style === 'dashed' ? '5 2.5' : undefined}
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
