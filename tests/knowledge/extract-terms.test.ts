import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/llm', () => ({
  callLLM: vi.fn(async () => ({
    text: JSON.stringify({
      nodes: [
        {
          name: '雅可比矩阵',
          // 归一化用例：与 name 重复、大小写重复、空串都应被剔除。
          aliases: ['Jacobian', 'jacobian', '雅可比矩阵', ''],
          category: '术语',
          content: '速度映射',
          type: 'term',
        },
        { name: '奇异位形', aliases: [], category: '概念', content: '机构失秩', type: 'concept' },
      ],
      links: [{ source: '雅可比矩阵', target: '奇异位形', relation: '指示' }],
    }),
  })),
}));

import { extractKnowledgeBundle } from '@/lib/knowledge/extract';

const model = { model: { providerId: 'x', modelId: 'y' } } as never;

it('抽取产物含 term 节点、单文档归属与边 id', async () => {
  const { bundle, stats } = await extractKnowledgeBundle({
    text: '雅可比矩阵可用于识别奇异位形。'.repeat(400),
    bundleId: 'b1',
    title: '运动学',
    ownerId: 'me',
    model,
  });
  expect(bundle.version).toBe(2);
  expect(bundle.documents).toHaveLength(1);
  const term = bundle.nodes.find((n) => n.name === '雅可比矩阵')!;
  expect(term.nodeType).toBe('term');
  expect(term.aliases).toEqual(['Jacobian']);
  expect(term.documentIds).toEqual([bundle.documents[0].id]);
  expect(bundle.links[0].id).toMatch(/^lnk_/);
  expect(stats.terms).toBe(1);
});
