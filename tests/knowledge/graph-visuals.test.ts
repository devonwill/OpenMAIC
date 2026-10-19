import { describe, expect, it } from 'vitest';
import {
  buildNeighborIds,
  COMMUNITY_COLORS,
  communityColor,
  computeDegree,
  linkDashArray,
  MAX_NODE_R,
  MIN_NODE_R,
  NODE_COLOR,
  nodeColor,
  normalizeRadius,
} from '@/lib/knowledge/graph-visuals';
import { KNOWLEDGE_NODE_TYPES } from '@/lib/knowledge/schema';

describe('nodeColor 类型五类配色', () => {
  it('五类色值与 spec §5.1 一致', () => {
    expect(NODE_COLOR).toEqual({
      literature: '#1d4ed8',
      person: '#60a5fa',
      concept: '#f59e0b',
      device: '#b45309',
      term: '#94a3b8',
    });
  });

  it('五类全部命中自身颜色', () => {
    for (const nodeType of KNOWLEDGE_NODE_TYPES) {
      expect(nodeColor(nodeType)).toBe(NODE_COLOR[nodeType]);
    }
  });

  it('未知/缺失类型兜底 concept 而非抛错', () => {
    expect(nodeColor('author')).toBe(NODE_COLOR.concept);
    expect(nodeColor(undefined)).toBe(NODE_COLOR.concept);
    expect(nodeColor(null)).toBe(NODE_COLOR.concept);
  });
});

describe('computeDegree 度数统计', () => {
  it('每条边给两端各 +1', () => {
    const degree = computeDegree([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'a', target: 'c' },
    ]);
    expect(degree.get('a')).toBe(2);
    expect(degree.get('b')).toBe(2);
    expect(degree.get('c')).toBe(2);
  });

  it('平行边累加，孤立节点不入表', () => {
    const degree = computeDegree([
      { source: 'a', target: 'b' },
      { source: 'a', target: 'b' },
    ]);
    expect(degree.get('a')).toBe(2);
    expect(degree.get('b')).toBe(2);
    expect(degree.has('lonely')).toBe(false);
  });

  it('自环给同一节点 +2（source、target 各计一次，与计划口径一致）', () => {
    const degree = computeDegree([{ source: 'a', target: 'a' }]);
    expect(degree.get('a')).toBe(2);
  });
});

describe('normalizeRadius 度数/PageRank → 半径', () => {
  it('0 → 下限 12，1 → 上限 40', () => {
    expect(normalizeRadius(0)).toBe(MIN_NODE_R);
    expect(normalizeRadius(1)).toBe(MAX_NODE_R);
  });

  it('越界输入夹取回 [0,1]', () => {
    expect(normalizeRadius(-3)).toBe(MIN_NODE_R);
    expect(normalizeRadius(9)).toBe(MAX_NODE_R);
  });

  it('sqrt 拉伸：0.5 处为 12 + 28·√0.5（大于线性中点 26）', () => {
    expect(normalizeRadius(0.5)).toBeCloseTo(MIN_NODE_R + (MAX_NODE_R - MIN_NODE_R) * Math.SQRT1_2, 10);
    expect(normalizeRadius(0.5)).toBeGreaterThan((MIN_NODE_R + MAX_NODE_R) / 2);
  });

  it('单调不减：度数越高半径越大', () => {
    expect(normalizeRadius(0.1)).toBeLessThan(normalizeRadius(0.6));
    expect(normalizeRadius(0.6)).toBeLessThan(normalizeRadius(0.9));
  });
});

describe('linkDashArray 线型 → 虚线', () => {
  it('引用/关联类虚线 6 3', () => {
    expect(linkDashArray('引用')).toBe('6 3');
    expect(linkDashArray('相关知识')).toBe('6 3');
  });

  it('包含/属于类实线返回 undefined', () => {
    expect(linkDashArray('包含')).toBeUndefined();
    expect(linkDashArray('属于')).toBeUndefined();
  });

  it('未知关系默认实线', () => {
    expect(linkDashArray('某种新关系')).toBeUndefined();
  });
});

describe('buildNeighborIds hover 邻居集合', () => {
  const links = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'd', target: 'e' },
  ];

  it('含源自身与直接邻居，不含二跳', () => {
    expect([...buildNeighborIds(links, 'a')].sort()).toEqual(['a', 'b']);
    expect([...buildNeighborIds(links, 'b')].sort()).toEqual(['a', 'b', 'c']);
  });

  it('无关系节点只含自身', () => {
    expect([...buildNeighborIds(links, 'x')]).toEqual(['x']);
  });

  it('反向边同样算邻居（无向语义）', () => {
    expect(buildNeighborIds([{ source: 'y', target: 'a' }], 'a').has('y')).toBe(true);
  });
});

describe('communityColor 社区外圈色', () => {
  it('同一 id 每次调用同色（可复现）', () => {
    expect(communityColor('node-1')).toBe(communityColor('node-1'));
  });

  it('输出始终在 5 色板内', () => {
    for (const id of ['a', 'node-1', 'concept::定义', '', 'very-long-community-id-xyz']) {
      expect(COMMUNITY_COLORS).toContain(communityColor(id));
    }
  });

  it('不同 id 能拉开至少两种颜色（避免全部同色）', () => {
    const colors = new Set(
      ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id) => communityColor(id)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
