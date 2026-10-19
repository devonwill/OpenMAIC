// app/api/knowledge/neighbors/route.ts
// Ego 懒加载端点：节点 id 仅在库内唯一，故请求必须带 bundle 参数定位库。
import { NextRequest, NextResponse } from 'next/server';
import { ensureLinkIds } from '@/lib/knowledge/library-store';
import { queryNeo4jNeighbors } from '@/lib/knowledge/graph-store';
import { buildCypherPreview, extractEgoSubgraph } from '@/lib/knowledge/graph-algorithms';
import { loadKnowledge } from '@/lib/knowledge/server';
import { canReadKnowledge, knowledgeRequestOwner } from '@/lib/knowledge/access';
import type { KnowledgeBundleV2 } from '@/lib/knowledge/schema';

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: NextRequest) {
  const headers = new Headers(NO_STORE);
  const params = request.nextUrl.searchParams;
  const selected = params.get('bundle');
  const nodeId = params.get('nodeId');
  const depthRaw = params.get('depth');
  // 必填参数缺失不进入加载流程，快速失败返回 400。
  if (!selected || !nodeId) {
    return NextResponse.json({ error: '缺少 bundle 或 nodeId' }, { status: 400, headers });
  }

  const ownerId = await knowledgeRequestOwner(request, headers);
  const { bundles, warnings: loadWarnings } = await loadKnowledge();
  const bundle = bundles.find((item) => item.id === selected && canReadKnowledge(item, ownerId));
  if (!bundle) {
    return NextResponse.json({ error: '资料库不存在' }, { status: 404, headers });
  }
  const ensured = ensureLinkIds(bundle as KnowledgeBundleV2);
  const center = ensured.nodes.find((item) => item.id === nodeId);
  if (!center) {
    return NextResponse.json({ error: '节点不存在' }, { status: 404, headers });
  }

  // depth 白名单放在库/节点定位之后：先报更具体的 404（库/节点不存在），
  // 再校验取值，避免"库都不存在却先报 depth 越界"误导调用方。
  if (depthRaw !== '1' && depthRaw !== '2') {
    return NextResponse.json({ error: 'depth 仅支持 1 或 2' }, { status: 400, headers });
  }
  const depth: 1 | 2 = depthRaw === '2' ? 2 : 1;

  const jsonIds = extractEgoSubgraph(ensured.nodes, ensured.links, center.id, depth);

  // Neo4j 优先；未配置/查询失败一律降级 JSON，错误只进 warnings 不阻断。
  const warnings = [...loadWarnings];
  let backend: 'neo4j' | 'json' = 'json';
  let neighborIds: string[] | null = null;
  try {
    const ids = await queryNeo4jNeighbors(selected, nodeId, depth);
    if (ids) {
      const graphIds = new Set([center.id, ...ids]);
      if (graphIds.size === jsonIds.size && [...graphIds].every((id) => jsonIds.has(id))) {
        backend = 'neo4j';
        neighborIds = ids;
      } else {
        warnings.push('图谱索引尚未同步，已使用最新资料数据。');
      }
    } else {
      warnings.push('NEO4J_URI 未配置，Ego 展开使用本地 JSON 数据');
    }
  } catch (error) {
    warnings.push(
      `Neo4j 查询失败已降级 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 两分支统一：id 集 = {中心} ∪ 邻居，再按 full 投影水合（结构天然一致）。
  // 拿到 Neo4j 结果用库内邻居；否则本地 BFS 展开 Ego，保证 JSON 分支与
  // Neo4j 分支返回同样的子图结构（否则兜底时只剩中心节点）。
  const idSet = neighborIds !== null ? new Set<string>([center.id, ...neighborIds]) : jsonIds;
  const nodes = ensured.nodes
    .filter((node) => idSet.has(node.id))
    .map((node) => ({
      id: node.id,
      name: node.name,
      category: node.category,
      nodeType: node.nodeType ?? 'concept',
      attributes: node.attributes ?? {},
      documentIds: node.documentIds ?? [],
      content: node.content,
      aliases: node.aliases,
    }));
  const links = ensured.links
    .filter((link) => idSet.has(link.source) && idSet.has(link.target))
    .map((link) => ({
      id: link.id!,
      source: link.source,
      target: link.target,
      relation: link.relation,
    }));

  const cypherPrefix = backend === 'json' ? '// 【需配置 NEO4J_URI】\n' : '';
  return NextResponse.json(
    {
      nodes,
      links,
      cypherPreview: cypherPrefix + buildCypherPreview(selected, nodeId, depth),
      backend,
      warnings,
    },
    { headers },
  );
}
