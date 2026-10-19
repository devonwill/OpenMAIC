import { describe, expect, it } from 'vitest';
import { auditSceneCitations, extractCitations } from '@/lib/knowledge/citation';
import type { KnowledgeBundle } from '@/lib/knowledge/schema';

function makeBundle(overrides: Partial<KnowledgeBundle> = {}): KnowledgeBundle {
  return {
    version: 2,
    id: 'robotics',
    title: '机器人学讲义',
    kind: 'graph',
    reviewStatus: 'reviewed',
    nodes: [
      {
        id: 'dh-parameters',
        name: 'D-H 参数法',
        aliases: ['Denavit-Hartenberg'],
        category: '运动学',
        content: '连杆坐标系建模方法。',
        source: { title: '机器人学讲义', locator: '第3章' },
      },
      {
        id: 'jacobian',
        name: '雅可比矩阵',
        aliases: [],
        category: '动力学',
        content: '速度映射矩阵。',
        source: { title: '机器人学讲义', locator: '第5章' },
      },
    ],
    links: [{ source: 'dh-parameters', target: 'jacobian', relation: '推导出' }],
    crossRefs: [],
    ...overrides,
  };
}

const REVIEWED = makeBundle();
const UNREVIEWED = makeBundle({ id: 'paper-pack', title: '未审论文包', reviewStatus: 'unreviewed' });

describe('extractCitations', () => {
  it('extracts unique citations in order of appearance', () => {
    const text =
      '结论 A [知识来源:robotics/dh-parameters]。结论 B [知识来源:robotics/jacobian]，重复 [知识来源:robotics/dh-parameters]。';
    expect(extractCitations(text)).toEqual([
      '[知识来源:robotics/dh-parameters]',
      '[知识来源:robotics/jacobian]',
    ]);
  });

  it('returns an empty list when there are no citations', () => {
    expect(extractCitations('没有引用的普通正文')).toEqual([]);
  });
});

describe('auditSceneCitations', () => {
  it('marks existing reviewed citations as valid with node/bundle titles', () => {
    const audit = auditSceneCitations(
      [REVIEWED],
      'D-H 参数法 [知识来源:robotics/dh-parameters] 可推导雅可比矩阵 [知识来源:robotics/jacobian]。',
    );
    expect(audit.total).toBe(2);
    expect(audit.invalid).toEqual([]);
    expect(audit.valid.map((item) => item.nodeName)).toEqual(['D-H 参数法', '雅可比矩阵']);
    expect(audit.valid[0].bundleTitle).toBe('机器人学讲义');
  });

  it('flags citations pointing at missing bundles or nodes as not-found', () => {
    const audit = auditSceneCitations(
      [REVIEWED],
      '编造的引用 [知识来源:ghost/node-a]，以及真实库里的假节点 [知识来源:robotics/nope]。',
    );
    expect(audit.total).toBe(2);
    expect(audit.valid).toEqual([]);
    expect(audit.invalid.map((item) => item.reason)).toEqual(['not-found', 'not-found']);
    expect(audit.invalid[1].bundleId).toBe('robotics');
    expect(audit.invalid[1].nodeId).toBe('nope');
  });

  it('flags citations from bundles that are not reviewed yet', () => {
    const audit = auditSceneCitations([REVIEWED, UNREVIEWED], '引用 [知识来源:paper-pack/dh-parameters]。');
    expect(audit.valid).toEqual([]);
    expect(audit.invalid).toEqual([
      {
        citation: '[知识来源:paper-pack/dh-parameters]',
        bundleId: 'paper-pack',
        nodeId: 'dh-parameters',
        reason: 'not-reviewed',
      },
    ]);
  });

  it('flags citations outside the selected bundle scope as out-of-scope', () => {
    const audit = auditSceneCitations(
      [REVIEWED],
      '越界引用 [知识来源:robotics/jacobian]。',
      ['another-bundle'],
    );
    expect(audit.valid).toEqual([]);
    expect(audit.invalid[0].reason).toBe('out-of-scope');
  });

  it('treats an empty selection as unrestricted scope', () => {
    const audit = auditSceneCitations([REVIEWED], '引用 [知识来源:robotics/jacobian]。', []);
    expect(audit.valid).toHaveLength(1);
    expect(audit.invalid).toEqual([]);
  });

  it('splits citations on the first slash so node ids may contain slashes', () => {
    const bundle = makeBundle();
    bundle.nodes[0].id = 'sec/3/dh';
    const audit = auditSceneCitations([bundle], '引用 [知识来源:robotics/sec/3/dh]。');
    expect(audit.valid).toHaveLength(1);
    expect(audit.valid[0].nodeId).toBe('sec/3/dh');
  });

  it('returns total 0 for text without citations', () => {
    const audit = auditSceneCitations([REVIEWED], '本页没有任何引用标记。');
    expect(audit).toEqual({ total: 0, valid: [], invalid: [] });
  });

  it('marks structurally broken citations as not-found', () => {
    const audit = auditSceneCitations([REVIEWED], '坏引用 [知识来源:no-separator]。');
    expect(audit.total).toBe(1);
    expect(audit.invalid[0].reason).toBe('not-found');
  });
});
