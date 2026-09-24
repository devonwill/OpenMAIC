import { NextRequest, NextResponse } from 'next/server';
import { loadKnowledge } from '@/lib/knowledge/server';
import { searchKnowledge } from '@/lib/knowledge/retrieval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { bundles, warnings } = await loadKnowledge();
  const query = (request.nextUrl.searchParams.get('q') || '').slice(0, 500);
  const selected = request.nextUrl.searchParams.get('bundle');
  const nodeId = request.nextUrl.searchParams.get('node');
  const bundle = bundles.find((item) => item.id === selected);
  const scoped = selected ? bundles.filter((item) => item.id === selected) : bundles;
  const hits = searchKnowledge(scoped, query, 12);
  const focusIds = new Set(hits.map((hit) => hit.node.id));
  const seedIds = new Set(focusIds);
  let visibleNodes = bundle?.nodes.slice(0, 60) ?? [];
  if (bundle && query) {
    for (const link of bundle.links) {
      if (seedIds.has(link.source)) focusIds.add(link.target);
      if (seedIds.has(link.target)) focusIds.add(link.source);
      // Direct neighbors only: build links below from the bounded node selection.
    }
    visibleNodes = bundle.nodes.filter((node) => focusIds.has(node.id)).slice(0, 60);
  }
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  return NextResponse.json(
    {
      catalog: bundles.map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        reviewStatus: item.reviewStatus,
        nodeCount: item.nodes.length,
        linkCount: item.links.length,
      })),
      warnings,
      classroomEnabled: process.env.KNOWLEDGE_CLASSROOM_ENABLED === 'true',
      hits,
      detail: bundle?.nodes.find((node) => node.id === nodeId) ?? null,
      graph: {
        nodes: visibleNodes.map(({ id, name, category }) => ({ id, name, category })),
        links:
          bundle?.links
            .filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target))
            .slice(0, 120) ?? [],
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
