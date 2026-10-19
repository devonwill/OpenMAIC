// lib/knowledge/graph-visuals.ts
// 图谱视觉编码纯函数（spec §5）：类型配色、度数→半径、线型→虚线、邻居集合、社区外圈色。
// 抽离为无依赖纯函数是为可测（TDD）：画布组件只负责接线，映射规则在 tests/knowledge/graph-visuals.test.ts 收口。
import type { KnowledgeNodeType } from './schema';
import { linkLineStyle } from './schema';

/** 节点半径下限：度数/PageRank 归一化 0 时的像素半径（spec §5.2）。 */
export const MIN_NODE_R = 12;
/** 节点半径上限：归一化 1 时的像素半径。 */
export const MAX_NODE_R = 40;

/** 节点配色（UESTC 蓝橙体系）：文献深蓝/人物浅蓝/概念橙/设备深橙/术语灰。 */
export const NODE_COLOR: Record<KnowledgeNodeType, string> = {
  literature: '#1d4ed8',
  person: '#60a5fa',
  concept: '#f59e0b',
  device: '#b45309',
  term: '#94a3b8',
};

/**
 * 类型 → 填充色，未知类型兜底 concept 而非抛错：
 * 运行时可能读到旧数据里的非法 nodeType，图谱渲染不应因此整体失败。
 */
export function nodeColor(nodeType: string | null | undefined): string {
  const color = nodeType ? NODE_COLOR[nodeType as KnowledgeNodeType] : undefined;
  return color ?? NODE_COLOR.concept;
}

/**
 * 无向图度数统计：每条边给 source、target 各 +1（与计划口径一致）。
 * 只统计出现过的 id，孤立节点不在结果里——取值方需用 `?? 0` 兜底。
 */
export function computeDegree(links: readonly { source: string; target: string }[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }
  return degree;
}

/**
 * 归一化值（度数占比或 PageRank 0..1）→ 半径 12..40px。
 * 用 sqrt 拉伸而非线性：大图里度数分布长尾，线性映射会让多数节点挤在下限。
 */
export function normalizeRadius(raw: number): number {
  const clamped = Math.max(0, Math.min(1, raw));
  return MIN_NODE_R + (MAX_NODE_R - MIN_NODE_R) * Math.sqrt(clamped);
}

/** 关系线型 → stroke-dasharray（spec §5.2 虚线 6 3）；实线返回 undefined 交给 SVG 默认值。 */
export function linkDashArray(relation: string): string | undefined {
  return linkLineStyle(relation) === 'dashed' ? '6 3' : undefined;
}

/**
 * hover 源节点 + 其直接邻居的 id 集合（含源自身），
 * 无关元素据此降到 0.12 透明度（spec §5.2 hover 高亮）。
 */
export function buildNeighborIds(
  links: { source: string; target: string }[],
  id: string,
): Set<string> {
  const result = new Set<string>([id]);
  for (const link of links) {
    if (link.source === id) result.add(link.target);
    else if (link.target === id) result.add(link.source);
  }
  return result;
}

/** 社区外圈调色板：5 色，独立于类型五类色，仅用于描边（spec §5.2 外圈）。 */
export const COMMUNITY_COLORS = ['#16a34a', '#dc2626', '#1d4ed8', '#0891b2', '#db2777'] as const;

/**
 * 社区代表 id → 稳定外圈色。用确定性 hash（31 进制滚动）而非随机：
 * 同一社区在重绘/导出时必须同色，否则视觉编码不可复现。
 */
export function communityColor(communityId: string): string {
  let hash = 0;
  for (let index = 0; index < communityId.length; index += 1) {
    hash = (hash * 31 + communityId.charCodeAt(index)) >>> 0;
  }
  return COMMUNITY_COLORS[hash % COMMUNITY_COLORS.length];
}
