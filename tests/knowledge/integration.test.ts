import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import { knowledgeBundleSchema, type KnowledgeBundle } from '@/lib/knowledge/schema';
import { searchKnowledge, formatKnowledgeEvidence } from '@/lib/knowledge/retrieval';
import {
  attachClassroomKnowledge,
  getClassroomKnowledge,
  loadKnowledge,
} from '@/lib/knowledge/server';
import { GET } from '@/app/api/knowledge/route';

const fixture = (status: KnowledgeBundle['reviewStatus'] = 'reviewed'): KnowledgeBundle => ({
  version: 1,
  id: 'robotics',
  title: '机器人学',
  kind: 'graph',
  reviewStatus: status,
  nodes: [
    {
      id: 'fk',
      name: '正运动学',
      aliases: ['forward kinematics'],
      category: '运动学',
      content: '给定关节角计算末端位置。',
      source: { title: '教师材料', locator: '第 2 章' },
    },
    {
      id: 'frame',
      name: '坐标变换',
      aliases: [],
      category: '运动学',
      content: '转换参考坐标系。',
      source: { title: '教师材料', locator: '第 1 章' },
    },
  ],
  links: [{ source: 'frame', target: 'fk', relation: '相关知识' }],
  crossRefs: [],
});
const directories: string[] = [];
async function setup(bundle = fixture()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'maic-knowledge-'));
  directories.push(directory);
  await writeFile(path.join(directory, 'robotics.json'), JSON.stringify(bundle));
  vi.stubEnv('KNOWLEDGE_DATA_DIR', directory);
  return directory;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('knowledge integration', () => {
  it('finds concepts inside natural language and preserves graph evidence', () => {
    const hits = searchKnowledge([fixture()], '请解释正运动学与关节角的关系');
    expect(hits[0].node.id).toBe('fk');
    expect(hits[0].relations[0].source).toBe('坐标变换');
    expect(searchKnowledge([fixture()], 'explain forward kinematics')[0].node.id).toBe('fk');
    expect(searchKnowledge([fixture()], '宇宙射线')).toEqual([]);
    expect(formatKnowledgeEvidence(hits)).toContain('[知识来源:robotics/fk]');
  });
  it('expands 1-hop graph neighbors for matched nodes without duplicating hits', () => {
    const hits = searchKnowledge([fixture()], '请解释正运动学与关节角的关系');
    expect(hits).toHaveLength(1);
    expect(hits[0].neighbors).toHaveLength(1);
    expect(hits[0].neighbors![0]).toMatchObject({
      id: 'frame',
      name: '坐标变换',
      relation: '相关知识',
      content: '转换参考坐标系。',
    });
    const evidence = formatKnowledgeEvidence(hits);
    // 邻居带可校验的 citation，供生成侧直接引用。
    expect(evidence).toContain('"neighbors"');
    expect(evidence).toContain('[知识来源:robotics/frame]');
  });
  it('enriches the last user turn without changing saved conversation history', async () => {
    await setup();
    vi.stubEnv('KNOWLEDGE_CLASSROOM_ENABLED', 'true');
    const messages = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: '正运动学' }] },
    ];
    const result = await attachClassroomKnowledge(messages);
    expect(messages[0].parts).toHaveLength(1);
    expect(result[0].parts).toHaveLength(2);
    expect(JSON.stringify(result)).toContain('[知识来源:robotics/fk]');
  });
  it('rejects duplicates and dangling relationships', () => {
    const bundle = fixture();
    bundle.nodes.push(bundle.nodes[0]);
    expect(knowledgeBundleSchema.safeParse(bundle).success).toBe(false);
    const dangling = fixture();
    dangling.links[0].target = 'missing';
    expect(knowledgeBundleSchema.safeParse(dangling).success).toBe(false);
  });
  it('does not inject demo or unreviewed material and respects the off switch', async () => {
    await setup();
    vi.stubEnv('KNOWLEDGE_CLASSROOM_ENABLED', 'false');
    expect(await getClassroomKnowledge('正运动学')).toBe('');
    vi.stubEnv('KNOWLEDGE_CLASSROOM_ENABLED', 'true');
    expect(await getClassroomKnowledge('正运动学')).toContain('第 2 章');
    const directory = process.env.KNOWLEDGE_DATA_DIR!;
    for (const status of ['demo', 'unreviewed'] as const) {
      await writeFile(path.join(directory, 'robotics.json'), JSON.stringify(fixture(status)));
      expect(await getClassroomKnowledge('正运动学')).toBe('');
    }
  });
  it('falls back to selected bundle overviews when the query has no keyword overlap', async () => {
    await setup();
    vi.stubEnv('KNOWLEDGE_CLASSROOM_ENABLED', 'true');
    // No selection + zero-hit query → nothing is injected (unchanged behaviour).
    expect(await getClassroomKnowledge('宇宙射线暴')).toBe('');
    // Explicit selection + zero-hit query → overview evidence from the chosen
    // bundle, so checked libraries are never silently ignored.
    const scoped = await getClassroomKnowledge('宇宙射线暴', { bundleIds: ['robotics'] });
    expect(scoped).toContain('[知识来源:robotics/');
    // The most connected node (fk, degree 1 tie broken by id) comes first.
    expect(scoped).toContain('正运动学');
    // Unreviewed selections never leak into the fallback either.
    const directory = process.env.KNOWLEDGE_DATA_DIR!;
    await writeFile(path.join(directory, 'robotics.json'), JSON.stringify(fixture('unreviewed')));
    expect(await getClassroomKnowledge('宇宙射线暴', { bundleIds: ['robotics'] })).toBe('');
  });
  it('skips corrupt packages without breaking valid knowledge or the classroom', async () => {
    const directory = await setup();
    await writeFile(path.join(directory, 'bad.json'), '{bad');
    const result = await loadKnowledge();
    expect(result.bundles).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    vi.stubEnv('KNOWLEDGE_DATA_DIR', path.join(directory, 'missing'));
    expect(await getClassroomKnowledge('正运动学')).toBe('');
  });
  it('returns bounded graph neighbors and source detail using the same catalog', async () => {
    await setup();
    const response = await GET(
      new NextRequest('http://localhost/api/knowledge?bundle=robotics&q=正运动学&node=fk'),
    );
    const body = await response.json();
    expect(body.hits[0].node.id).toBe('fk');
    expect(body.detail.source.locator).toBe('第 2 章');
    expect(body.graph.nodes).toHaveLength(2);
    expect(body.graph.links).toHaveLength(1);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('imports old graph API format and refuses to overwrite a prior import', async () => {
    const directory = await setup();
    const filename = path.join(directory, 'legacy.txt');
    await writeFile(
      filename,
      JSON.stringify({
        data: {
          nodes: [{ id: 'RA01', name_ch: '正运动学', name: 'FK', definition: '示例' }],
          links: [],
        },
      }),
    );
    const args = [
      '--import',
      'tsx',
      'scripts/import-knowledge.ts',
      '--graph',
      filename,
      '--id',
      'legacy',
      '--title',
      '旧图谱',
      '--out',
      directory,
    ];
    execFileSync(process.execPath, args, { cwd: process.cwd(), stdio: 'pipe' });
    const { bundles } = await loadKnowledge();
    const imported = bundles.find((bundle) => bundle.id === 'legacy');
    expect(imported?.reviewStatus).toBe('unreviewed');
    expect(imported?.nodes[0].aliases).toContain('FK');
    expect(() =>
      execFileSync(process.execPath, args, { cwd: process.cwd(), stdio: 'pipe' }),
    ).toThrow();
  });
});
