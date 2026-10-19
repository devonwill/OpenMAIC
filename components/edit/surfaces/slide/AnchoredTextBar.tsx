/**
 * 本文件：文本元素的锚定工具条。
 * 职责：为选中的文本元素就近提供格式化控件、层级调整（置顶/置底）与删除。
 * 关键点：外壳（贴边定位、避让）由 AnchoredBar 负责，本组件只排内容。
 */
'use client';

import { AnchoredBar } from './AnchoredBar';
import { ConnectedTextFormatBar } from './text-format-bar';
import { DeleteButton } from './DeleteButton';
import { ZOrderButtons } from './ZOrderButtons';

interface AnchoredTextBarProps {
  /** The text element being edited, or "" when no text element is being edited. */
  readonly editingElementId: string;
}

const Separator = () => <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800" />;

/**
 * The selection-anchored bar for a text element — the format controls, z-order
 * (to-front/to-back), and delete, hugging the element being edited. See
 * AnchoredBar for the shell.
 *
 * 中文要点：内容顺序为格式化 → 层级 → 删除，用分隔线分组。
 */
export function AnchoredTextBar({ editingElementId }: AnchoredTextBarProps) {
  return (
    <AnchoredBar elementId={editingElementId}>
      <div className="flex items-center gap-1">
        <ConnectedTextFormatBar elementId={editingElementId} />
        <Separator />
        <ZOrderButtons elementId={editingElementId} />
        <Separator />
        <DeleteButton elementId={editingElementId} />
      </div>
    </AnchoredBar>
  );
}
