/**
 * 本文件：幻灯片视频元素的渲染组件（编辑态）。
 * 职责：按媒体解析状态渲染骨架屏/禁用/失败占位、封面图或视频，
 *       提供点选、锁定与失败重试入口。
 * 关键点：编辑态不自动播放（避免干扰编辑）；重试按钮需阻断
 *       冒泡，防止触发元素点选；状态分支优先级 pending/placeholder
 *       → disabled → failed → poster → src。
 */
'use client';

import type { PPTVideoElement } from '@openmaic/dsl';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useMediaStageId } from '@/lib/contexts/media-stage-context';
import { mediaFailureNoticeKey } from '@/lib/media/media-failure';
import { mediaResolutionCanRetry } from '@/lib/media/resolve-media-ref';
import { useSettingsStore } from '@/lib/store/settings';
import { RotateCcw, ShieldAlert, VideoOff } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSceneData } from '@/lib/contexts/scene-context';
import type { SlideContent } from '@/lib/types/stage';
import { mediaRetryTarget, retryMediaTask } from '@/lib/media/media-orchestrator';
import { useResolvedVideoMedia } from './useResolvedVideoMedia';

export interface VideoElementProps {
  elementInfo: PPTVideoElement;
  selectElement?: (e: React.MouseEvent | React.TouchEvent, element: PPTVideoElement) => void;
}

/**
 * Editable video element component.
 * In edit mode, displays the poster/thumbnail with a play icon overlay.
 * Does NOT autoplay to avoid disrupting the editing experience.
 * 中文：编辑态只显示封面 + 播放图标，不自动播放。
 */
export function VideoElement({ elementInfo, selectElement }: VideoElementProps) {
  const { t } = useI18n();
  const { sceneId, sceneData } = useSceneData<SlideContent>();
  const stageId = useMediaStageId();
  const mediaGenerationDisabled = useSettingsStore((state) => !state.videoGenerationEnabled);
  const tasks = useMediaGenerationStore((state) => state.tasks);
  const { mediaRef, resolution, resolvedSrc, resolvedPoster, task } = useResolvedVideoMedia(
    elementInfo,
    tasks,
    stageId,
    mediaGenerationDisabled,
  );
  const canRetry = mediaResolutionCanRetry(resolution);
  // A refusal says why, next to the Retry rather than instead of it -- and only
  // next to one, so a permanent refusal still paints exactly what it painted
  // before this branch. See the note in the image element.
  // 中文：仅可重试的失败才展示拒绝原因提示，且与重试按钮并排而非替代，
  //   保持不可重试场景的原有渲染不变。
  const failureNotice = canRetry ? mediaFailureNoticeKey(task?.errorCode) : undefined;
  const retryRef = mediaRef;

  const handleSelectElement = (e: React.MouseEvent | React.TouchEvent) => {
    if (elementInfo.lock) return;
    e.stopPropagation();
    selectElement?.(e, elementInfo);
  };

  return (
    <div
      className={`editable-element-video absolute ${elementInfo.lock ? 'lock' : ''}`}
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
      }}
    >
      <div
        className="rotate-wrapper w-full h-full"
        style={{ transform: `rotate(${elementInfo.rotate}deg)` }}
      >
        <div
          className={`element-content w-full h-full relative ${elementInfo.lock ? '' : 'cursor-move'}`}
          onMouseDown={handleSelectElement}
          onTouchStart={handleSelectElement}
        >
          {resolution.kind === 'pending' || resolution.kind === 'placeholder' ? (
            <div className="w-full h-full animate-pulse rounded bg-black/10" />
          ) : resolution.kind === 'disabled' ? (
            <div
              className="flex h-full w-full items-center justify-center gap-1 rounded bg-gray-50 px-2 text-[10px] font-medium text-gray-500 dark:bg-gray-900/20 dark:text-gray-400"
              data-media-state="disabled"
            >
              <VideoOff className="h-3 w-3 shrink-0" />
              <span>{t('settings.mediaGenerationDisabled')}</span>
            </div>
          ) : resolution.kind === 'failed' ? (
            <div
              // Stacked only when there is something to stack; see the image
              // element's note.
              className={
                failureNotice
                  ? 'flex h-full w-full flex-col items-center justify-center gap-1.5 rounded bg-red-50 dark:bg-red-900/20'
                  : 'flex h-full w-full items-center justify-center rounded bg-red-50 dark:bg-red-900/20'
              }
            >
              {failureNotice ? (
                <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  <ShieldAlert className="h-3 w-3 shrink-0" />
                  <span>{t(failureNotice)}</span>
                </div>
              ) : null}
              {canRetry && retryRef ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    retryMediaTask(retryRef, mediaRetryTarget(elementInfo.id, sceneId, sceneData));
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-[10px] font-medium text-red-600"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('settings.mediaRetry')}
                </button>
              ) : null}
            </div>
          ) : resolvedPoster ? (
            <img
              className="w-full h-full"
              style={{ objectFit: 'contain' }}
              src={resolvedPoster}
              alt=""
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
            />
          ) : resolvedSrc ? (
            <video
              className="w-full h-full"
              style={{ objectFit: 'contain', pointerEvents: 'none' }}
              src={resolvedSrc}
              preload="metadata"
            />
          ) : (
            <div className="w-full h-full bg-black/10 rounded" />
          )}

          {canRetry && retryRef && resolution.kind !== 'failed' ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                retryMediaTask(retryRef, mediaRetryTarget(elementInfo.id, sceneId, sceneData));
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded bg-red-100/95 px-2 py-1 text-[10px] font-medium text-red-600 shadow-sm"
            >
              <RotateCcw className="h-3 w-3" />
              {t('settings.mediaRetry')}
            </button>
          ) : null}

          {/* Play icon overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
              <svg className="w-6 h-6 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
