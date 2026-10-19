/**
 * 本文件：视频元素媒体引用的解析 Hook。
 * 职责：结合媒体任务表、stageId 与生成开关，把视频元素的
 *       src/poster 引用解析为可渲染 URL 及其解析状态。
 * 关键点：与图片解析共用 useResolvedMediaRef 状态机，
 *       保证编辑态与只读态对 pending/disabled/failed 的表现一致。
 */
'use client';

import type { PPTVideoElement } from '@openmaic/dsl';
import type { MediaTask } from '@/lib/store/media-generation';
import { resolveVideoMediaForElement } from '@/lib/media/media-task-resolution';
import {
  renderableMediaUrl,
  useResolvedMediaRef,
  type MediaResolution,
} from '@/lib/media/resolve-media-ref';

export interface ResolvedVideoMedia {
  readonly mediaRef: string | undefined;
  readonly task: MediaTask | undefined;
  readonly resolution: MediaResolution;
  readonly posterResolution: MediaResolution;
  readonly resolvedSrc: string | undefined;
  readonly resolvedPoster: string | undefined;
}

/**
 * Shared direct-video binding used by both the read-only and editor elements.
 * 中文：只读态与编辑态共用的视频解析入口；poster 单独解析，
 *       不受生成开关影响（封面可来自已有资产）。
 */
export function useResolvedVideoMedia(
  element: PPTVideoElement,
  tasks: Readonly<Record<string, MediaTask>>,
  stageId: string | undefined,
  mediaGenerationDisabled: boolean,
): ResolvedVideoMedia {
  const binding = resolveVideoMediaForElement(tasks, element, stageId);
  const resolution = useResolvedMediaRef(binding.sourceRef, binding.task, mediaGenerationDisabled);
  const posterResolution = useResolvedMediaRef(binding.posterRef, binding.posterTask);
  return {
    mediaRef: binding.mediaRef,
    task: binding.task,
    resolution,
    posterResolution,
    resolvedSrc: renderableMediaUrl(resolution),
    resolvedPoster: renderableMediaUrl(posterResolution),
  };
}
