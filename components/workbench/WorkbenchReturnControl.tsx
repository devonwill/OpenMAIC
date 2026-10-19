/**
 * 本文件：全屏播放返回工作台的控件。
 * 职责：在课堂头部左侧渲染返回按钮，点击关闭 playback 模式、恢复对话区。
 * 关键点：对话折叠与面板状态存于 store，返回时按原样恢复而非重建。
 */
'use client';

/**
 * The way back from full-screen playback to the workbench. The canvas pager or
 * preview toolbar steps the workbench chrome aside; this control — hosted in the
 * classroom header's left slot while a session is attached — is what brings
 * the conversation back. Chat fold and panel state live in the store, so the
 * return restores them exactly.
 */
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useWorkbenchStore } from '@/lib/workbench/session-store';

// 纯状态开关：仅把 playbackOn 置回 false，其余 UI 由 store 派生。
export function WorkbenchReturnControl() {
  const { t } = useI18n();
  const setPlaybackOn = useWorkbenchStore((s) => s.setPlaybackOn);
  return (
    <button
      type="button"
      data-testid="workbench-return"
      onClick={() => setPlaybackOn(false)}
      title={t('workbench.common.backToWorkspace')}
      aria-label={t('workbench.common.backToWorkspace')}
      className="inline-flex shrink-0 items-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
    </button>
  );
}
