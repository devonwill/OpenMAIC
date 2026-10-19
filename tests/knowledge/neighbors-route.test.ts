// tests/knowledge/neighbors-route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/knowledge/neighbors/route';
import { queryNeo4jNeighbors } from '@/lib/knowledge/graph-store';

vi.mock('@/lib/knowledge/graph-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge/graph-store')>();
  return { ...actual, queryNeo4jNeighbors: vi.fn() };
});

function fixture() {
  return {
    id: 'robotics',
    title: '机器人学',
    version: 1,
    kind: 'graph',
    description: '',
    crossRefs: [],
    nodes: [
      {
        id: 'fk',
        name: '正运动学',
        category: '概念',
        nodeType: 'concept',
        attributes: {},
        documentIds: ['doc-1'],
        content: 'FK 说明',
        aliases: [],
      },
      {
        id: 'frame',
        name: '坐标系',
        category: '概念',
        nodeType: 'concept',
        attributes: {},
        documentIds: [],
        content: '',
        aliases: [],
      },
    ],
    links: [{ source: 'frame', target: 'fk', relation: '相关知识' }],
  };
}

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'neighbors-'));
  await writeFile(path.join(directory, 'robotics.json'), JSON.stringify(fixture()), 'utf8');
  vi.stubEnv('KNOWLEDGE_DATA_DIR', directory);
  vi.stubEnv('NEO4J_URI', '');
  return directory;
}

const mocked = vi.mocked(queryNeo4jNeighbors);

describe('GET /api/knowledge/neighbors', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await setup();
    mocked.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  const call = (search: string) =>
    GET(new NextRequest(`http://localhost/api/knowledge/neighbors${search}`));

  it('Neo4j 分支：返回邻居节点与边并标记 backend', async () => {
    mocked.mockResolvedValueOnce(['frame']);
    const response = await call('?bundle=robotics&nodeId=fk&depth=1');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload = await response.json();
    expect(payload.backend).toBe('neo4j');
    // 结构：中心 + 邻居
    expect(payload.nodes.map((item: { id: string }) => item.id).sort()).toEqual(['fk', 'frame']);
    expect(payload.links).toHaveLength(1);
    expect(payload.cypherPreview).not.toContain('需配置');
  });

  it('JSON 兜底分支：结构与 Neo4j 分支完全一致', async () => {
    mocked.mockResolvedValueOnce(null);
    const response = await call('?bundle=robotics&nodeId=fk&depth=1');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.backend).toBe('json');
    expect(payload.nodes.map((item: { id: string }) => item.id).sort()).toEqual(['fk', 'frame']);
    expect(payload.links).toHaveLength(1);
    // 未配置 Neo4j 时给出配置提示前缀
    expect(payload.cypherPreview).toContain('需配置 NEO4J_URI');
  });

  it('Neo4j 抛错时降级 JSON 并携带 warnings', async () => {
    mocked.mockRejectedValueOnce(new Error('connection refused'));
    const response = await call('?bundle=robotics&nodeId=fk&depth=1');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.backend).toBe('json');
    expect(payload.warnings.join(' ')).toContain('降级');
  });

  it('uses the current JSON when the graph index is stale', async () => {
    mocked.mockResolvedValueOnce([]);
    const payload = await (await call('?bundle=robotics&nodeId=fk&depth=1')).json();
    expect(payload.backend).toBe('json');
    expect(payload.nodes.map((item: { id: string }) => item.id).sort()).toEqual(['fk', 'frame']);
    expect(payload.warnings.join(' ')).toContain('尚未同步');
  });

  it('缺参或 depth 越界返回 400', async () => {
    expect((await call('?nodeId=fk')).status).toBe(400);
    expect((await call('?bundle=robotics&nodeId=fk')).status).toBe(400);
    expect((await call('?bundle=robotics&nodeId=fk&depth=3')).status).toBe(400);
  });

  it('库或节点不存在返回 404', async () => {
    expect((await call('?bundle=nope&nodeId=fk')).status).toBe(404);
    expect((await call('?bundle=robotics&nodeId=nope')).status).toBe(404);
  });
});
