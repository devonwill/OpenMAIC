/**
 * 本文件：技能句柄（skill handle）整块退格删除 Hook。
 * 职责：在各输入框中拦截 Backspace，把「技能 token」作为整体删除单位，
 * 防止逐字符删成无法解析的残缺句柄。
 * 关键点：输入法组合期（isComposing / 键码 229）直接放行，避免破坏中文输入；
 * value 保持纯文本，撤销栈、粘贴、自动增高仍由浏览器接管。
 */
'use client';

/**
 * Backspace deletes a whole skill handle, in every composer.
 *
 * A handle is one object to the reader and one to the model, so character-by-
 * character deletion leaves `/k12-core-literacy-plannin` — a handle that resolves
 * to nothing. This makes the token the unit of deletion without giving up the
 * native `<textarea>`: the value stays plain text, so IME composition, the undo
 * stack, paste and autosize are all still the browser's.
 *
 * IME FIRST. `isComposing` (and the legacy 229 keycode) short-circuit everything:
 * rewriting the value under a live composition is exactly how Chinese input breaks,
 * and this product is Chinese-first. Anything other than the narrow case — a
 * selection, a caret mid-handle, ordinary prose — falls through to the browser.
 */
import { useCallback, type KeyboardEvent } from 'react';

import { deleteSkillHandleBefore } from '@/lib/workbench/composer-skills';

export function useSkillHandleBackspace(
  setDraft: (next: string) => void,
  /**
   * Record where the caret goes once the controlled value has landed. A callback
   * rather than the caller's ref: the composer owns that ref, and a hook reaching
   * into a value handed to it is both a lint error here and the wrong shape.
   */
  onCaret: (caret: number) => void,
): (event: KeyboardEvent<HTMLTextAreaElement>) => boolean {
  return useCallback(
    (event) => {
      if (event.key !== 'Backspace') return false;
      // 输入法组合中不改写 value，否则中文输入会被打断（本产品中文优先）。
      if (event.nativeEvent.isComposing || event.keyCode === 229) return false;
      const textarea = event.currentTarget;
      // A selection already has a unit of deletion: its own.
      // 有选区时选区本身就是删除单位，交给浏览器原生行为。
      if (textarea.selectionStart !== textarea.selectionEnd) return false;
      const deletion = deleteSkillHandleBefore(textarea.value, textarea.selectionStart ?? 0);
      if (!deletion) return false;
      event.preventDefault();
      onCaret(deletion.caret);
      setDraft(deletion.draft);
      return true;
    },
    [onCaret, setDraft],
  );
}
