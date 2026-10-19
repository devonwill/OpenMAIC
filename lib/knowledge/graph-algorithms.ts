// lib/knowledge/graph-algorithms.ts
// 纯函数图算法：无向图语义、按输入顺序遍历，保证同一输入产出同一结果（测试可复现）。

interface NodeLike { id: string; name?: string }
interface LinkLike { source: string; target: string }

/** 构建无向邻接表；Set 去重但保留插入序。 */
export function buildAdjacency(nodes: NodeLike[], links: LinkLike[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of nodes) adj.set(node.id, new Set());
  for (const link of links) {
    if (!adj.has(link.source) || !adj.has(link.target)) continue;
    adj.get(link.source)!.add(link.target);
    adj.get(link.target)!.add(link.source);
  }
  return adj;
}

/**
 * 幂迭代 PageRank。dangling 节点的分数按 (1-d)/n 全局重分配，
 * 保证各分量（含孤立点）分数不丢失、总和恒为 1。
 */
export function computePageRank(
  nodes: NodeLike[],
  links: LinkLike[],
  options: { damping?: number; maxIterations?: number; tolerance?: number } = {},
): Map<string, number> {
  const { damping = 0.85, maxIterations = 100, tolerance = 1e-6 } = options;
  const adj = buildAdjacency(nodes, links);
  const ids = nodes.map((node) => node.id);
  const n = ids.length;
  if (n === 0) return new Map();
  const base = 1 / n;
  let rank = new Map<string, number>(ids.map((id) => [id, base]));

  for (let iter = 0; iter < maxIterations; iter += 1) {
    const next = new Map<string, number>(ids.map((id) => [id, 0]));
    let dangling = 0;
    for (const id of ids) {
      const neighbors = adj.get(id)!;
      if (neighbors.size === 0) {
        dangling += rank.get(id)!;
        continue;
      }
      const share = rank.get(id)! / neighbors.size;
      for (const target of neighbors) next.set(target, next.get(target)! + share);
    }
    // dangling 质量与 teleport 质量合并均分，避免迭代中分数流失导致总和 < 1。
    const inject = (1 - damping) / n + (damping * dangling) / n;
    let diff = 0;
    for (const id of ids) {
      const value = inject + damping * next.get(id)!;
      diff += Math.abs(value - rank.get(id)!);
      next.set(id, value);
    }
    rank = next;
    if (diff < tolerance) break;
  }
  return rank;
}

/** BFS 最短路径（无向）；from===to 返回 [from]，未知/不连通返回 null。 */
export function shortestPath(nodes: NodeLike[], links: LinkLike[], from: string, to: string): string[] | null {
  const adj = buildAdjacency(nodes, links);
  if (!adj.has(from) || !adj.has(to)) return null;
  if (from === to) return [from];
  const prev = new Map<string, string>();
  const visited = new Set<string>([from]);
  const queue: string[] = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adj.get(current)!) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, current);
      if (next === to) {
        const path = [to];
        let step = to;
        while (prev.has(step)) {
          step = prev.get(step)!;
          path.unshift(step);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * 同步标签传播：初始标签=自身，逐轮「自身+邻居」投票，
 * 平票取字典序最小的候选（确定性关键），≤20 轮无变化即停。
 */
export function detectCommunities(nodes: NodeLike[], links: LinkLike[]): Map<string, string> {
  const adj = buildAdjacency(nodes, links);
  const labels = new Map<string, string>(nodes.map((node) => [node.id, node.id]));
  for (let round = 0; round < 20; round += 1) {
    let changed = false;
    for (const node of nodes) {
      const candidates = [labels.get(node.id)!, ...[...adj.get(node.id)!].map((id) => labels.get(id)!)];
      const votes = new Map<string, number>();
      for (const candidate of candidates) votes.set(candidate, (votes.get(candidate) ?? 0) + 1);
      // 平票裁决：票数降序 → key 字典序升序取先者；若按 Map 插入序取首会随遍历顺序漂移，结果不可复现。
      const best = [...votes.entries()]
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0][0];
      if (best !== labels.get(node.id)) {
        labels.set(node.id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return labels;
}

/** 提取中心节点 depth 跳（1|2）内的子图节点 id 集合，始终包含中心。 */
export function extractEgoSubgraph(nodes: NodeLike[], links: LinkLike[], centerId: string, depth: 1 | 2): Set<string> {
  const adj = buildAdjacency(nodes, links);
  const result = new Set<string>();
  if (!adj.has(centerId)) return result;
  result.add(centerId);
  let frontier = new Set<string>([centerId]);
  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<string>();
    for (const id of frontier) for (const neighbor of adj.get(id)!) next.add(neighbor);
    for (const id of next) result.add(id);
    frontier = next;
    if (frontier.size === 0) break;
  }
  return result;
}

/** 生成 Ego 查询的 Cypher 预览（只读，不执行）；compositeId 内联并转义单引号。 */
export function buildCypherPreview(bundleId: string, nodeId: string, depth: 1 | 2): string {
  const composite = `${bundleId}::${nodeId}`.replace(/'/g, "\\'");
  return [
    `MATCH (c:KnowledgeNode {compositeId: '${composite}'})`,
    `MATCH (c)-[r:KNOWS*1..${depth}]-(n:KnowledgeNode)`,
    'RETURN c, r, n LIMIT 200',
  ].join('\n');
}
