import { describe, expect, it, vi } from 'vitest';
import { writeGraphSnapshot, type GraphTransaction } from '@/lib/knowledge/graph-store';
import { createEmptyLibrary } from '@/lib/knowledge/library-store';

function bundle(id: string, target: string) {
  return {
    ...createEmptyLibrary({ id, title: id, ownerId: 'user:one' }),
    nodes: [
      {
        id: 'node',
        name: id,
        category: 'concept',
        content: '',
        aliases: [],
        source: { title: id, locator: '1' },
      },
    ],
    crossRefs: [
      { node: 'node', targetBundleId: target, targetNodeId: 'node', relation: 'references' },
    ],
  };
}

describe('graph snapshot ordering', () => {
  it('creates forward and reverse cross-bundle references after all endpoints exist', async () => {
    const nodes = new Set<string>();
    const edges: string[] = [];
    const run = vi.fn<GraphTransaction['run']>(async (query, params) => {
      if (query.includes('MERGE (n:KnowledgeNode')) {
        for (const row of params!.rows as { compositeId: string }[]) nodes.add(row.compositeId);
      }
      if (query.includes('CREATE (a)-[r:KNOWS')) {
        const rows = params!.rows as { source: string; target: string }[];
        const created = rows.filter((row) => nodes.has(row.source) && nodes.has(row.target));
        edges.push(...created.map((row) => `${row.source}->${row.target}`));
        return { records: [{ get: () => created.length }] };
      }
      return { records: [] };
    });
    const result = await writeGraphSnapshot({ run }, [bundle('a', 'b'), bundle('b', 'a')]);
    expect(result).toEqual({ nodes: 2, relationships: 2, skippedCrossRefs: 0 });
    expect(edges).toEqual(['a::node->b::node', 'b::node->a::node']);
    // Existing referenced nodes are retained; only absent nodes may be detached.
    expect(run.mock.calls[0][0]).toContain('WHERE NOT n.compositeId IN $ids');
    expect(run.mock.calls[0][1]).toEqual({ ids: ['a::node', 'b::node'] });
  });
  it('propagates write failures so the enclosing transaction rolls back', async () => {
    const run = vi
      .fn<GraphTransaction['run']>()
      .mockResolvedValueOnce({ records: [] })
      .mockRejectedValueOnce(new Error('write failed'));
    await expect(writeGraphSnapshot({ run }, [bundle('a', 'b')])).rejects.toThrow('write failed');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
