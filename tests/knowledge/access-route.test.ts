import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '@/app/api/knowledge/route';
import { GET as neighbors } from '@/app/api/knowledge/neighbors/route';
import { createEmptyLibrary } from '@/lib/knowledge/library-store';
import { saveKnowledgeBundle } from '@/lib/knowledge/storage';
import { getClassroomKnowledge } from '@/lib/knowledge/server';

const owner = 'anon:11111111-1111-4111-8111-111111111111';
const headers = { cookie: 'anonymous_id=11111111-1111-4111-8111-111111111111' };
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'knowledge-access-'));
  vi.stubEnv('KNOWLEDGE_DATA_DIR', directory);
  vi.stubEnv('CODE_DATA_DIR', path.join(directory, 'code'));
  vi.stubEnv('SESSION_SECRET', '');
  vi.stubEnv('NEO4J_URI', '');
  vi.stubEnv('KNOWLEDGE_CLASSROOM_ENABLED', 'true');
  for (const [id, ownerId] of [
    ['mine', owner],
    ['other', 'user:other'],
    ['shared', undefined],
  ] as const) {
    await saveKnowledgeBundle({
      ...createEmptyLibrary({ id, title: id, ownerId: ownerId ?? owner }),
      ownerId,
      reviewStatus: 'reviewed',
      nodes: [
        {
          id: 'node',
          name: `${id} robot`,
          content: `${id} confidential text`,
          category: '概念',
          aliases: [],
          source: { title: id, locator: '1' },
        },
      ],
      documents: [
        {
          id: 'doc',
          title: 'source',
          filename: 'source.txt',
          uploadedAt: new Date().toISOString(),
          nodeCount: 1,
          content: 'full document text',
        },
      ],
    });
  }
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
const req = (query = '') => new NextRequest(`http://localhost/api/knowledge${query}`, { headers });

describe('knowledge ownership boundaries', () => {
  it('returns only owned and shared catalog/search data', async () => {
    const data = await (await GET(req('?q=robot'))).json();
    expect(data.catalog.map((item: { id: string }) => item.id).sort()).toEqual(['mine', 'shared']);
    expect(JSON.stringify(data)).not.toContain('other confidential');
  });
  it('rejects direct document and neighbor access to another owner', async () => {
    expect((await GET(req('?bundle=other&document=doc'))).status).toBe(404);
    expect((await neighbors(req('?bundle=other&nodeId=node&depth=1'))).status).toBe(404);
  });
  it('omits document bodies from listings but loads them on demand for the owner', async () => {
    const listing = await (await GET(req('?bundle=mine'))).json();
    expect(listing.documents[0].content).toBeUndefined();
    const detail = await (await GET(req('?bundle=mine&document=doc'))).json();
    expect(detail.document.content).toBe('full document text');
  });
  it("limits classroom retrieval even when a caller explicitly selects another owner's bundle", async () => {
    expect(await getClassroomKnowledge('robot', { ownerId: owner, bundleIds: ['other'] })).toBe('');
    const evidence = await getClassroomKnowledge('robot', { ownerId: owner });
    expect(evidence).toContain('mine confidential');
    expect(evidence).toContain('shared confidential');
    expect(evidence).not.toContain('other confidential');
    expect(await getClassroomKnowledge('robot')).not.toContain('mine confidential');
  });
  it('keeps shared bundles read-only and handles invalid JSON shapes as client errors', async () => {
    const edit = new NextRequest('http://localhost/api/knowledge', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ id: 'shared', reviewStatus: 'demo' }),
    });
    expect((await PATCH(edit)).status).toBe(403);
    for (const method of [PATCH, DELETE]) {
      expect(
        (
          await method(
            new NextRequest('http://localhost/api/knowledge', {
              method: 'PATCH',
              headers,
              body: 'null',
            }),
          )
        ).status,
      ).toBe(400);
    }
  });
});
