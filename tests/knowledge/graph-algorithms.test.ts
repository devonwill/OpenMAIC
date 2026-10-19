// tests/knowledge/graph-algorithms.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildCypherPreview,
  computePageRank,
  detectCommunities,
  extractEgoSubgraph,
  shortestPath,
} from '@/lib/knowledge/graph-algorithms';

const n = (id: string) => ({ id, name: id });
const l = (source: string, target: string) => ({ id: `${source}-${target}`, source, target, relation: '相关' });

describe('computePageRank', () => {
  it('星形图中心分数最高且总和约等于 1', () => {
    const nodes = [n('c'), n('a'), n('b'), n('d')];
    const links = [l('c', 'a'), l('c', 'b'), l('c', 'd')];
    const rank = computePageRank(nodes, links);
    expect(rank.get('c')).toBeGreaterThan(rank.get('a')!);
    const sum = [...rank.values()].reduce((acc, v) => acc + v, 0);
    expect(sum).toBeCloseTo(1, 4);
  });
});

describe('shortestPath', () => {
  const nodes = [n('a'), n('b'), n('c'), n('d')];
  const links = [l('a', 'b'), l('b', 'c'), l('c', 'd')];

  it('链上取最短路径', () => {
    expect(shortestPath(nodes, links, 'a', 'd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('起点即终点返回单元素', () => {
    expect(shortestPath(nodes, links, 'a', 'a')).toEqual(['a']);
  });

  it('未知或不连通返回 null', () => {
    expect(shortestPath(nodes, links, 'a', 'zzz')).toBeNull();
    expect(shortestPath(nodes, links, 'a', 'x')).toBeNull();
  });
});

describe('detectCommunities', () => {
  it('两个互不连通的三角形恰为 2 个社区且结果确定', () => {
    const nodes = [n('a'), n('b'), n('c'), n('d'), n('e'), n('f')];
    const links = [
      l('a', 'b'), l('b', 'c'), l('c', 'a'),
      l('d', 'e'), l('e', 'f'), l('f', 'd'),
    ];
    const first = detectCommunities(nodes, links);
    const second = detectCommunities(nodes, links);
    expect(first).toEqual(second);
    expect(new Set(first.values()).size).toBe(2);
    // 两分量内部各自同社区
    expect(first.get('a')).toBe(first.get('b'));
    expect(first.get('d')).toBe(first.get('e'));
    expect(first.get('a')).not.toBe(first.get('d'));
  });
});

describe('extractEgoSubgraph', () => {
  const nodes = [n('c'), n('a'), n('b'), n('x')];
  const links = [l('c', 'a'), l('a', 'b'), l('b', 'x')];

  it('depth=1 只含直接邻居', () => {
    expect([...extractEgoSubgraph(nodes, links, 'c', 1)].sort()).toEqual(['a', 'c']);
  });

  it('depth=2 扩到二级', () => {
    expect([...extractEgoSubgraph(nodes, links, 'c', 2)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('未知中心返回空集合', () => {
    expect(extractEgoSubgraph(nodes, links, 'zzz', 2).size).toBe(0);
  });
});

describe('buildCypherPreview', () => {
  it('内联 compositeId 并转义单引号', () => {
    const cypher = buildCypherPreview('robotics', "it's", 2);
    expect(cypher).toContain("compositeId: 'robotics::it\\'s'");
    expect(cypher).toContain('*1..2');
    expect(cypher).toContain('KNOWS');
  });
});
