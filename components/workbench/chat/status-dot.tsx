/**
 * 本文件：统一状态点组件与状态归一化工具。
 * 职责：把各来源的自由字符串状态映射为 5 种视觉语义
 * （ok / error / running / suspended / idle），供工具行、工具组、rail 头部共用。
 * 关键点：running 渲染为小转圈而非呼吸点，静态态一律是圆点。
 */
'use client';

/**
 * Unified status dot — one color vocabulary for ok / error / running /
 * suspended / idle, used by tool rows, tool groups and the rail header.
 * Ported from OpenPBL's `status-dot.tsx`; `running` is a small spinner
 * (never a breathing dot), the static kinds stay dots.
 */
import { LoaderCircle } from 'lucide-react';
import { wbStyles } from './chat-styles';

export type StatusDotKind = 'ok' | 'error' | 'running' | 'suspended' | 'idle';

/** 把多套上游状态词（done/success/in_progress/queued…）归并到统一枚举；未知值落到 idle。 */
export function normalizeStatusDot(status?: string): StatusDotKind {
  switch (status) {
    case 'ok':
    case 'done':
    case 'completed':
    case 'success':
    case 'succeeded':
      return 'ok';
    case 'error':
    case 'failed':
    case 'danger':
      return 'error';
    case 'running':
    case 'working':
    case 'in_progress':
    case 'active':
    case 'queued':
    case 'pending':
    case 'connecting':
      return 'running';
    case 'suspended':
    case 'cancelled':
      return 'suspended';
    default:
      return 'idle';
  }
}

// running 单独渲染为转圈图标，其余状态用带 data-kind 的圆点区分颜色。
export function StatusDot({ status }: { status?: string }) {
  const kind = normalizeStatusDot(status);
  if (kind === 'running') {
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-3 shrink-0 animate-spin text-[var(--wb-accent)] motion-reduce:animate-none"
      />
    );
  }
  return <span className={wbStyles.statusDot} data-kind={kind} aria-hidden="true" />;
}
