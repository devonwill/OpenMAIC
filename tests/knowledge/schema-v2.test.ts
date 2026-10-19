import { describe, expect, it } from 'vitest';
import { knowledgeBundleSchema, upgradeBundleToV2 } from '@/lib/knowledge/schema';

const v1Bundle = {
  version: 1,
  id: 'old-one',
  title: '旧库',
  kind: 'paper',
  reviewStatus: 'reviewed',
  nodes: [
    { id: 'k1-a', name: 'A', aliases: [], category: '概念', content: '关于A', source: { title: '旧库', locator: '片段 1' } },
  ],
  links: [],
  crossRefs: [],
};

describe('schema v2 migration', () => {
  it('v1 解析后升级：合成文档、节点补 nodeType/documentIds/attributes', () => {
    const parsed = knowledgeBundleSchema.parse(v1Bundle);
    const v2 = upgradeBundleToV2(parsed, '2026-01-01T00:00:00.000Z');
    expect(v2.version).toBe(2);
    expect(v2.documents).toHaveLength(1);
    expect(v2.documents[0].id).toBe('doc_legacy');
    expect(v2.nodes[0].nodeType).toBe('concept');
    expect(v2.nodes[0].documentIds).toEqual(['doc_legacy']);
    expect(v2.nodes[0].attributes).toEqual({});
    expect(v2.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('v2 数据原样通过：保留 term 与自定义属性', () => {
    const v2 = upgradeBundleToV2(
      knowledgeBundleSchema.parse({
        ...v1Bundle,
        version: 2,
        description: 'd',
        documents: [],
        nodes: [{ ...v1Bundle.nodes[0], nodeType: 'term', documentIds: [], attributes: { 单位: 'rad/s' } }],
      }),
      '2026-01-02T00:00:00.000Z',
    );
    expect(v2.nodes[0].nodeType).toBe('term');
    expect(v2.nodes[0].attributes).toEqual({ 单位: 'rad/s' });
    expect(v2.documents).toEqual([]);
  });

  it('attributes 超过 20 对时校验失败', () => {
    const attrs = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v']));
    const result = knowledgeBundleSchema.safeParse({
      ...v1Bundle,
      nodes: [{ ...v1Bundle.nodes[0], attributes: attrs }],
    });
    expect(result.success).toBe(false);
  });
});
