// lib/knowledge/graph-workspace.ts
// 三栏工作区的纯函数层：搜索、类型/子图过滤、统计聚合、算法结果投影、Ego 合并与渲染上限。
// 抽离为零依赖纯函数是为可测（TDD）——组件只负责状态接线，规则在 tests/knowledge/graph-workspace.test.ts 收口。
import { computeDegree } from './graph-visuals';
import { KNOWLEDGE_NODE_TYPES, LINK_STYLE, type KnowledgeNodeType } from './schema';

/** 节点类型中文标签：node-editor.tsx 内有同名私有映射，此处独立定义避免跨组件导出耦合。 */
export const NODE_TYPE_LABEL: Record<KnowledgeNodeType, string> = {
  literature: '文献',
  person: '人物',
  concept: '概念',
  device: '设备',
  term: '术语',
};

/** 搜索用最小节点形状：FullNode 结构性满足，测试可用轻量工厂。 */
export interface SearchableNode {
  id: string;
  name: string;
  aliases?: readonly string[];
  category?: string;
}

/**
 * 按 名称/别名/分类 做不区分大小写的包含匹配，返回前 limit 条。
 * 保持 nodes 输入顺序（不按相关度重排），下拉列表才稳定可复现；
 * 空文本返回空数组，避免输入框聚焦时一次性灌入全部节点。
 */
export function searchNodes<T extends SearchableNode>(
  nodes: readonly T[],
  text: string,
  limit = 8,
): T[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return [];
  const result: T[] = [];
  for (const node of nodes) {
    const matched = [node.name, ...(node.aliases ?? []), node.category ?? ''].some((field) =>
      field.toLowerCase().includes(needle),
    );
    if (!matched) continue;
    result.push(node);
    if (result.length >= limit) break;
  }
  return result;
}

/** 过滤用最小节点形状。 */
export interface TypedNode {
  id: string;
  nodeType: KnowledgeNodeType;
}

export interface FilterOptions {
  /** 左栏 5 类勾选；null/缺省 = 不筛。 */
  enabledTypes?: Set<KnowledgeNodeType> | null;
  /** 子图提取（Ego）结果；null/缺省 = 全量。 */
  visibleIds?: Set<string> | null;
}

/**
 * 按类型勾选与子图提取过滤节点与边，产出统计/算法/画布共用的同一口径。
 * 边的两端必须都存活，否则丢弃——否则统计会数进「悬空边」，与画面对不上。
 */
export function filterVisibleGraph<
  TNode extends TypedNode,
  TLink extends { source: string; target: string },
>(
  nodes: readonly TNode[],
  links: readonly TLink[],
  options: FilterOptions = {},
): { nodes: TNode[]; links: TLink[] } {
  const { enabledTypes = null, visibleIds = null } = options;
  const filteredNodes = nodes.filter(
    (node) =>
      (!enabledTypes || enabledTypes.has(node.nodeType)) &&
      (!visibleIds || visibleIds.has(node.id)),
  );
  const alive = new Set(filteredNodes.map((node) => node.id));
  const filteredLinks = links.filter((link) => alive.has(link.source) && alive.has(link.target));
  return { nodes: filteredNodes, links: filteredLinks };
}

/**
 * 按类型计数；五类恒定出现（值为 0 也保留），饼图与勾选行共用。
 * 计数结果不含「未知类型」兜底：数据经 zod 枚举校验，运行时不会出现非法 nodeType。
 */
export function typeCounts<T extends TypedNode>(
  nodes: readonly T[],
): Record<KnowledgeNodeType, number> {
  const counts = Object.fromEntries(
    KNOWLEDGE_NODE_TYPES.map((type) => [type, 0]),
  ) as Record<KnowledgeNodeType, number>;
  for (const node of nodes) counts[node.nodeType] += 1;
  return counts;
}

/**
 * 路径节点序列 → 涉及的边 id 集合（无向匹配，平行边全收），供画布橙色加粗。
 * 路径长度 ≤ 节点数（800 规模），对边表线性扫描一次的代价可接受。
 */
export function pathLinkIds<TLink extends { id: string; source: string; target: string }>(
  links: readonly TLink[],
  path: readonly string[],
): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index + 1 < path.length; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    for (const link of links) {
      const forward = link.source === from && link.target === to;
      const backward = link.source === to && link.target === from;
      if (forward || backward) result.add(link.id);
    }
  }
  return result;
}

/**
 * PageRank 分数 → 0..1 半径覆盖表（除以最大值，让最高分节点拿满 40px）。
 * 全 0（空图）时返回空表，交回度数基础值兜底。
 */
export function normalizeRanks(ranks: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const value of ranks.values()) if (value > max) max = value;
  if (max <= 0) return new Map();
  const result = new Map<string, number>();
  for (const [id, value] of ranks) result.set(id, value / max);
  return result;
}

export interface PageRankTop {
  id: string;
  name: string;
  score: number;
}

/**
 * PageRank Top-N 列表：分数降序，同分按 id 字典序——排序键无随机成分，
 * 同一输入在重渲染/测试中顺序必须一致。
 */
export function topPageRank<TNode extends { id: string; name: string }>(
  ranks: Map<string, number>,
  nodes: readonly TNode[],
  limit = 5,
): PageRankTop[] {
  const nameOf = new Map(nodes.map((node) => [node.id, node.name]));
  return [...ranks.entries()]
    .map(([id, score]) => ({ id, name: nameOf.get(id) ?? id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export interface NeighborEntry<TNode, TLink> {
  node: TNode;
  relation: string;
  link: TLink;
}

/**
 * 选中节点的直接邻居列表（按 links 输入序），供右栏邻接卡片点选定位。
 * 查不到节点详情的端点（如跨包边）跳过，避免渲染 undefined 名称。
 */
export function listNodeNeighbors<
  TNode extends { id: string; name: string },
  TLink extends { id: string; source: string; target: string; relation: string },
>(nodeId: string, links: readonly TLink[], nodes: readonly TNode[]): NeighborEntry<TNode, TLink>[] {
  const nodeOf = new Map(nodes.map((node) => [node.id, node]));
  const result: NeighborEntry<TNode, TLink>[] = [];
  for (const link of links) {
    let neighborId: string | null = null;
    if (link.source === nodeId) neighborId = link.target;
    else if (link.target === nodeId) neighborId = link.source;
    if (neighborId === null) continue;
    const neighbor = nodeOf.get(neighborId);
    if (!neighbor) continue;
    result.push({ node: neighbor, relation: link.relation, link });
  }
  return result;
}

/**
 * 按 id 合并基线与新增集（Ego 展开合入）：基线在前保证同 id 保留基线版本——
 * 展开返回的副本可能落后于本地编辑，不能覆盖既有节点；
 * 新 id 按 additions 顺序追加在尾部，使 idsKey 保持「旧前缀 + 新后缀」，
 * 画布 mergeLayout 才能识别为增量补位而非整图重排（旧节点不跳位）。
 */
export function mergeById<T extends { id: string }>(
  base: readonly T[],
  additions: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of [...base, ...additions]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

/** 渲染节点数上限（spec §4.2）：超限截断并展示提示条，防 hover 交互卡顿。 */
export const RENDER_NODE_CAP = 800;

/**
 * 超过上限时按度数降序保留前 cap 个节点，再裁掉两端不全存活的边。
 * 截断按「统计之后」的同一份 renderNodes 执行，保证统计/算法/画布口径一致；
 * 同度数按输入序 tie-break（稳定排序），同一数据每次截断结果可复现。
 * 保留集按输入序回填输出，idsKey 是原序列的稳定子集，画布不会误判为重排。
 */
export function applyRenderCap<
  TNode extends { id: string },
  TLink extends { source: string; target: string },
>(
  nodes: readonly TNode[],
  links: readonly TLink[],
  cap: number = RENDER_NODE_CAP,
): { nodes: TNode[]; links: TLink[]; capped: boolean } {
  if (nodes.length <= cap) {
    return { nodes: [...nodes], links: [...links], capped: false };
  }
  const degree = computeDegree(links);
  const ranked = nodes
    .map((node, index) => ({ node, index }))
    .sort(
      (a, b) =>
        (degree.get(b.node.id) ?? 0) - (degree.get(a.node.id) ?? 0) || a.index - b.index,
    );
  const keptIds = new Set(ranked.slice(0, cap).map((entry) => entry.node.id));
  return {
    nodes: nodes.filter((node) => keptIds.has(node.id)),
    links: links.filter((link) => keptIds.has(link.source) && keptIds.has(link.target)),
    capped: true,
  };
}

export interface FocusTransform {
  pan: { x: number; y: number };
  zoom: number;
}

/**
 * 搜索定位的平移变换：画布坐标系下世界点 p 的屏幕坐标 = pan + p × zoom，
 * 反解 pan = center − p × zoom 即可把目标点送到视口中心（公式经单测收口）。
 */
export function computeFocusTransform(
  pos: { x: number; y: number },
  center: { x: number; y: number },
  zoom = 1.2,
): FocusTransform {
  return { pan: { x: center.x - pos.x * zoom, y: center.y - pos.y * zoom }, zoom };
}

/**
 * 导出图例条目：5 类节点标签 + 实线/虚线两条线型说明（spec §4.3 含图例导出）。
 * 线型条目用「实线：」「虚线：」前缀标识，画布序列化时据此画线段而非类型圆点；
 * 关键词取自 LINK_STYLE 声明序，保证图例与画布实际线型规则同源不漂移。
 */
export function buildExportLegend(): string[] {
  const keywordsOf = (style: 'solid' | 'dashed') =>
    Object.entries(LINK_STYLE)
      .filter(([, value]) => value === style)
      .map(([keyword]) => keyword);
  return [
    ...KNOWLEDGE_NODE_TYPES.map((type) => NODE_TYPE_LABEL[type]),
    `实线：${keywordsOf('solid').join('/')}`,
    `虚线：${keywordsOf('dashed').join('/')}`,
  ];
}
