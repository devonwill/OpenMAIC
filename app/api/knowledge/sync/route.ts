import { NextRequest, NextResponse } from 'next/server';
import {
  getGraphBackendStatus,
  syncKnowledgeToGraph,
  checkGraphIntegrity,
} from '@/lib/knowledge/graph-store';

import { canReadKnowledge, knowledgeRequestOwner } from '@/lib/knowledge/access';
import { loadKnowledge } from '@/lib/knowledge/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Graph backend status (JSON fallback vs configured Neo4j) for the 图1 badge. */
export async function GET() {
  return NextResponse.json(
    { backend: await getGraphBackendStatus() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Manual full sync: knowledge bundles first, then code bundles (crossRef targets exist). */
export async function POST(request: NextRequest) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  try {
    const ownerId = await knowledgeRequestOwner(request, headers);
    const result = await syncKnowledgeToGraph();
    const { bundles } = await loadKnowledge();
    const visible = bundles.filter((bundle) => canReadKnowledge(bundle, ownerId));
    return NextResponse.json(
      { ...result, integrity: checkGraphIntegrity(visible) },
      { status: 200, headers },
    );
  } catch (error) {
    return NextResponse.json(
      { synced: false, error: error instanceof Error ? error.message : '同步失败' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
