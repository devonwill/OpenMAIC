/**
 * 本文件：工作台对话块共用的小型格式化工具。
 * 职责：把毫秒时长渲染为 ms / s / m s 可读文本，供工具行、思考块等复用。
 * 关键点：事件时间戳存的是数字毫秒而非 ISO 字符串，故直接做数值运算。
 */
/** Shared small formatters for the workbench chat blocks. */

/**
 * A duration between two event timestamps. The workbench fold stores event
 * `ts` (numbers), not ISO strings, so this takes milliseconds directly.
 */
export function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  const minutes = Math.floor(s / 60);
  const seconds = Math.round(s % 60);
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

/** 由起止时间戳求时长；任一端缺失时返回空串，避免显示 "NaNs"。 */
export function formatDurationBetween(startedAt?: number, endedAt?: number): string {
  if (startedAt === undefined || endedAt === undefined) return '';
  return formatDurationMs(endedAt - startedAt);
}
