/**
 * 本文件：图片元素 src 的媒体解析 Hook 与纯函数。
 * 职责：把 gen_img_* 占位符或资源池引用解析为可渲染 URL，并给出
 *       待生成/禁用/失败等 resolution 状态供 UI 分支使用。
 * 关键点：仅在有 stageId（课堂上下文）时订阅媒体 store，避免首页缩略图
 *         跨课程串数据；纯函数 resolveImageSrc 便于单测。
 */
'use client';

import type { PPTImageElement } from '@openmaic/dsl';
import { useMediaStageId } from '@/lib/contexts/media-stage-context';
import {
  MISSING_ASSET_LEASE,
  isConcreteMediaAddress,
  renderableMediaUrl,
  resolveMediaRef,
  useResolvedMediaRef,
  type MediaResolution,
} from '@/lib/media/resolve-media-ref';
import { isGeneratedMediaPlaceholder } from '@/lib/media/media-ref';
import { useMediaGenerationStore, type MediaTask } from '@/lib/store/media-generation';
import { useSettingsStore } from '@/lib/store/settings';
import { resolveMediaTaskForElement } from '@/lib/media/media-task-resolution';

export interface ResolvedImageSrc {
  /**
   * The src safe to feed to `<img>`. Concrete addresses and resolved asset URLs
   * pass through; placeholders and unresolved opaque refs become an empty src.
   */
  readonly resolvedSrc: string;
  readonly isPlaceholder: boolean;
  readonly resolvedFromAsset: boolean;
  readonly task: MediaTask | undefined;
  readonly resolution: MediaResolution;
}

/**
 * Pure resolver — no hooks. Given an image element plus the already-resolved
 * stageId and possibly-keyed task, computes the final resolution shape.
 * Splitting this out of the hook keeps the logic unit-testable in a plain
 * node environment (no RTL/jsdom needed).
 *
 * Direct and relative browser addresses pass through. Opaque references are
 * rendered only after the asset lease or task supplies a concrete URL. Tasks
 * are honored only when they belong to the current stage.
 *
 * 中文：直接地址（URL/data URI）原样通过；不透明引用必须等资源租约或
 * 任务给出具体 URL 才渲染；跨 stage 的任务一律忽略。
 */
export function resolveImageSrc(
  elementInfo: PPTImageElement,
  stageId: string | undefined,
  task: MediaTask | undefined,
  assetUrl?: string | null,
  mediaGenerationDisabled = false,
): ResolvedImageSrc {
  const isPlaceholder = !!stageId && isGeneratedMediaPlaceholder(elementInfo.src);
  const effectiveTask =
    stageId && !isConcreteMediaAddress(elementInfo.src) && task?.stageId === stageId
      ? task
      : undefined;
  const lease = assetUrl ? ({ status: 'resolved', url: assetUrl } as const) : MISSING_ASSET_LEASE;
  const resolution = resolveMediaRef(
    elementInfo.src,
    effectiveTask,
    lease,
    mediaGenerationDisabled,
  );
  const resolvedSrc = renderableMediaUrl(resolution) ?? '';
  return {
    resolvedSrc,
    isPlaceholder,
    resolvedFromAsset: resolution.kind === 'url',
    task: effectiveTask,
    resolution,
  };
}

/**
 * Resolve a slide image element's src against the media generation store so
 * `gen_img_*` placeholders display the generated objectUrl once the task is
 * ready. Shared by:
 *
 *   - `BaseImageElement` — the read-only playback variant (consumes the full
 *     return shape for skeleton / error / disabled UX);
 *   - `ImageElement` (this folder's `index.tsx`) — the interactive editor
 *     canvas variant, which historically rendered `elementInfo.src` raw and
 *     therefore showed a broken-image icon when entering Pro mode on any
 *     slide whose image element was a generation placeholder.
 *
 * Only subscribe to the media store when inside a classroom (stageId provided
 * via context). Homepage thumbnails have no stageId context → skip the store
 * to prevent cross-course contamination.
 */
export function useResolvedImageSrc(elementInfo: PPTImageElement): ResolvedImageSrc {
  const stageId = useMediaStageId();
  const mediaGenerationDisabled = useSettingsStore((state) => !state.imageGenerationEnabled);
  const task = useMediaGenerationStore((state) =>
    resolveMediaTaskForElement(state.tasks, elementInfo, stageId),
  );
  const resolution = useResolvedMediaRef(elementInfo.src, task, mediaGenerationDisabled);
  return {
    resolvedSrc: renderableMediaUrl(resolution) ?? '',
    isPlaceholder: !!stageId && isGeneratedMediaPlaceholder(elementInfo.src),
    resolvedFromAsset: resolution.kind === 'url',
    task,
    resolution,
  };
}
