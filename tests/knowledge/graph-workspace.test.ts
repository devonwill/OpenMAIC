import { describe, expect, it } from 'vitest';
import {
  applyRenderCap,
  buildExportLegend,
  computeFocusTransform,
  filterVisibleGraph,
  listNodeNeighbors,
  mergeById,
  NODE_TYPE_LABEL,
  normalizeRanks,
  pathLinkIds,
  RENDER_NODE_CAP,
  searchNodes,
  topPageRank,
  typeCounts,
} from '@/lib/knowledge/graph-workspace';
import { KNOWLEDGE_NODE_TYPES, type KnowledgeNodeType } from '@/lib/knowledge/schema';

/** 轻量节点工厂：只填纯函数真正读取的字段。 */
const typedNode = (id: string, nodeType: KnowledgeNodeType = 'concept') => ({ id, nodeType });
const namedNode = (id: string, name = id) => ({ id, name });
const link = (id: string, source: string, target: string, relation = '关联') => ({
  id,
  source,
  target,
  relation,
});

describe('NODE_TYPE_LABEL 类型中文标签', () => {
  it('五类标签齐全且为中文', () => {
    expect(NODE_TYPE_LABEL).toEqual({
      literature: '文献',
      person: '人物',
      concept: '概念',
      device: '设备',
      term: '术语',
    });
    for (const type of KNOWLEDGE_NODE_TYPES) {
      expect(NODE_TYPE_LABEL[type]).toBeTruthy();
    }
  });
});

describe('searchNodes 节点搜索', () => {
  const nodes = [
    { id: '1', name: 'SLAM', aliases: ['同步定位与建图'], category: '算法' },
    { id: '2', name: '深度学习', aliases: ['Deep Learning'], category: '方法论' },
    { id: '3', name: '机器人学', aliases: [], category: '学科' },
  ];

  it('匹配 name / aliases / category 三个字段', () => {
    expect(searchNodes(nodes, 'SLAM').map((n) => n.id)).toEqual(['1']);
    expect(searchNodes(nodes, '同步定位').map((n) => n.id)).toEqual(['1']);
    expect(searchNodes(nodes, '方法论').map((n) => n.id)).toEqual(['2']);
  });

  it('不区分大小写', () => {
    expect(searchNodes(nodes, 'deep').map((n) => n.id)).toEqual(['2']);
    expect(searchNodes(nodes, 'DEEP').map((n) => n.id)).toEqual(['2']);
  });

  it('空/纯空白文本不返回任何结果（避免下拉灌入全量）', () => {
    expect(searchNodes(nodes, '')).toEqual([]);
    expect(searchNodes(nodes, '   ')).toEqual([]);
  });

  it('limit 截断且保持输入顺序', () => {
    const many = Array.from({ length: 20 }, (_, i) => namedNode(String(i), `节点${i}`));
    const result = searchNodes(many, '节点', 8);
    expect(result).toHaveLength(8);
    expect(result.map((n) => n.id)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
  });

  it('无匹配返回空数组', () => {
    expect(searchNodes(nodes, '不存在的关键词')).toEqual([]);
  });
});

describe('filterVisibleGraph 类型/子图过滤', () => {
  const nodes = [
    typedNode('a', 'literature'),
    typedNode('b', 'person'),
    typedNode('c', 'term'),
  ];
  const links = [link('ab', 'a', 'b'), link('bc', 'b', 'c'), link('ac', 'a', 'c')];

  it('无筛选条件时原样返回', () => {
    const result = filterVisibleGraph(nodes, links);
    expect(result.nodes).toHaveLength(3);
    expect(result.links).toHaveLength(3);
  });

  it('类型勾选：被禁类型的节点与其连边一并移除', () => {
    const enabledTypes = new Set<KnowledgeNodeType>(['literature', 'person']);
    const result = filterVisibleGraph(nodes, links, { enabledTypes });
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    // c 被移除 → bc、ac 两端不完整 → 丢弃
    expect(result.links.map((l) => l.id)).toEqual(['ab']);
  });

  it('子图提取：只保留 visibleIds 内的节点与内部边', () => {
    const result = filterVisibleGraph(nodes, links, { visibleIds: new Set(['a', 'b']) });
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(result.links.map((l) => l.id)).toEqual(['ab']);
  });

  it('类型 + 子图两个条件叠加生效', () => {
    const result = filterVisibleGraph(nodes, links, {
      enabledTypes: new Set<KnowledgeNodeType>(['literature']),
      visibleIds: new Set(['a', 'b']),
    });
    expect(result.nodes.map((n) => n.id)).toEqual(['a']);
    expect(result.links).toEqual([]);
  });

  it('孤立节点（无边）在过滤后仍保留', () => {
    const lonely = typedNode('z', 'term');
    const result = filterVisibleGraph([...nodes, lonely], links, {
      enabledTypes: new Set<KnowledgeNodeType>(['term']),
    });
    expect(result.nodes.map((n) => n.id)).toEqual(['c', 'z']);
    expect(result.links).toEqual([]);
  });
});

describe('typeCounts 类型计数', () => {
  it('五类齐全，未出现的类型计 0（饼图/勾选行口径一致）', () => {
    const counts = typeCounts([typedNode('a', 'literature'), typedNode('b', 'literature')]);
    expect(counts).toEqual({ literature: 2, person: 0, concept: 0, device: 0, term: 0 });
  });

  it('空输入返回全 0 表', () => {
    expect(typeCounts([])).toEqual({ literature: 0, person: 0, concept: 0, device: 0, term: 0 });
  });
});

describe('pathLinkIds 路径 → 边集', () => {
  const links = [
    link('l1', 'a', 'b'),
    link('l2', 'b', 'c'),
    link('l3', 'a', 'c'),
    link('l4', 'c', 'd'),
  ];

  it('收集路径相邻节点对之间的边（无向）', () => {
    expect([...pathLinkIds(links, ['a', 'b', 'c'])].sort()).toEqual(['l1', 'l2']);
  });

  it('反向边同样命中（无向语义）', () => {
    expect([...pathLinkIds([{ id: 'x', source: 'c', target: 'b' }], ['b', 'c'])]).toEqual(['x']);
  });

  it('路径外的边不收（a→c 直连边不入 a-b-c 路径）', () => {
    const ids = pathLinkIds(links, ['a', 'b', 'c']);
    expect(ids.has('l3')).toBe(false);
    expect(ids.has('l4')).toBe(false);
  });

  it('平行边全部命中；单节点路径返回空集', () => {
    const parallel = [
      { id: 'p1', source: 'a', target: 'b' },
      { id: 'p2', source: 'b', target: 'a' },
    ];
    expect([...pathLinkIds(parallel, ['a', 'b'])].sort()).toEqual(['p1', 'p2']);
    expect(pathLinkIds(links, ['a']).size).toBe(0);
  });
});

describe('normalizeRanks PageRank → 半径覆盖', () => {
  it('除以最大值归一到 0..1', () => {
    const result = normalizeRanks(
      new Map([
        ['a', 0.5],
        ['b', 0.25],
      ]),
    );
    expect(result.get('a')).toBe(1);
    expect(result.get('b')).toBe(0.5);
  });

  it('全 0 返回空表（交回度数基础值）', () => {
    expect(normalizeRanks(new Map([['a', 0]]))).toEqual(new Map());
    expect(normalizeRanks(new Map())).toEqual(new Map());
  });
});

describe('topPageRank PageRank Top-N', () => {
  const nodes = [namedNode('a', '甲'), namedNode('b', '乙'), namedNode('c', '丙')];
  const ranks = new Map([
    ['a', 0.2],
    ['b', 0.5],
    ['c', 0.3],
  ]);

  it('按分数降序取前 N', () => {
    expect(topPageRank(ranks, nodes, 2).map((t) => t.id)).toEqual(['b', 'c']);
    expect(topPageRank(ranks, nodes, 2)[0].name).toBe('乙');
  });

  it('同分按 id 字典序，顺序可复现', () => {
    const tied = new Map([
      ['b', 0.4],
      ['a', 0.4],
    ]);
    expect(topPageRank(tied, nodes).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('ranks 里的未知 id 用 id 兜底名称', () => {
    const withUnknown = new Map([['ghost', 0.9]]);
    expect(topPageRank(withUnknown, nodes)[0].name).toBe('ghost');
  });

  it('limit 超过候选数时返回全部', () => {
    expect(topPageRank(ranks, nodes, 10)).toHaveLength(3);
  });
});

describe('listNodeNeighbors 邻接列表', () => {
  const nodes = [namedNode('a', '甲'), namedNode('b', '乙'), namedNode('c', '丙')];
  const links = [
    link('l1', 'a', 'b'),
    link('l2', 'c', 'a'),
    link('l3', 'b', 'c'),
    link('l4', 'x', 'y'),
  ];

  it('返回选中节点的邻居、关系与所属边，保持输入序', () => {
    const result = listNodeNeighbors('a', links, nodes);
    expect(result.map((e) => [e.node.id, e.relation, e.link.id])).toEqual([
      ['b', '关联', 'l1'],
      ['c', '关联', 'l2'],
    ]);
  });

  it('跳过查不到节点详情的悬空端点', () => {
    // l4 两端 x/y 都不在 nodes 中：查询 x 时不应产出 undefined 邻居
    expect(listNodeNeighbors('x', links, nodes)).toEqual([]);
  });

  it('自环只产出一条', () => {
    const selfLoop = [{ id: 'self', source: 'a', target: 'a', relation: '自指' }];
    const result = listNodeNeighbors('a', selfLoop, nodes);
    expect(result).toHaveLength(1);
    expect(result[0].relation).toBe('自指');
  });

  it('无关联节点返回空数组', () => {
    expect(listNodeNeighbors('a', [], nodes)).toEqual([]);
  });
});

describe('mergeById 按 id 合并去重（Ego 展开合入）', () => {
  const base = [
    { id: 'a', name: '基线甲' },
    { id: 'b', name: '基线乙' },
  ];

  it('同 id 保留基线版本，新增项按 additions 顺序追加在尾部', () => {
    const additions = [
      { id: 'a', name: '展开副本' },
      { id: 'c', name: '新丙' },
      { id: 'd', name: '新丁' },
    ];
    const result = mergeById(base, additions);
    // 基线优先：既有节点以上游数据为准，展开副本不能覆盖（防旧数据顶掉新编辑）
    expect(result.map((n) => [n.id, n.name])).toEqual([
      ['a', '基线甲'],
      ['b', '基线乙'],
      ['c', '新丙'],
      ['d', '新丁'],
    ]);
  });

  it('新增项内部重复 id 只保留首个', () => {
    const result = mergeById(base, [
      { id: 'c', name: '首个' },
      { id: 'c', name: '重复' },
    ]);
    expect(result.map((n) => n.name)).toEqual(['基线甲', '基线乙', '首个']);
  });

  it('基线自身重复 id 同样去重（保留首个）', () => {
    const result = mergeById(
      [
        { id: 'a', name: '首' },
        { id: 'a', name: '次' },
      ],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('首');
  });

  it('空 additions 返回等价内容的新数组（不共享引用）', () => {
    const result = mergeById(base, []);
    expect(result).toEqual(base);
    expect(result).not.toBe(base);
  });
});

describe('applyRenderCap 800 节点上限截断', () => {
  // 度数：a=3、b=1、c=1、d=0（孤立），输入序 a,b,c,d
  const nodes = ['a', 'b', 'c', 'd'].map((id) => namedNode(id, `节点${id}`));
  const links = [link('ab', 'a', 'b'), link('ac', 'a', 'c'), link('ad', 'a', 'd'), link('bc', 'b', 'c')];

  it('上限常量为 800（与 spec §4.2 一致）', () => {
    expect(RENDER_NODE_CAP).toBe(800);
  });

  it('未超上限原样返回内容且 capped=false', () => {
    const result = applyRenderCap(nodes, links, 4);
    expect(result.capped).toBe(false);
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.links).toHaveLength(4);
  });

  it('恰好等于上限不截断（>cap 才截）', () => {
    expect(applyRenderCap(nodes, links, 4).capped).toBe(false);
    expect(applyRenderCap(nodes, links, 3).capped).toBe(true);
  });

  it('超上限按度数降序保留；同度保持输入顺序（结果可复现）', () => {
    const result = applyRenderCap(nodes, links, 2);
    expect(result.capped).toBe(true);
    // a 度 3 必留；b/c 同度 1，b 输入在前 → 保 b 舍 c；d 度 0 最后舍弃
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    // 保留集仍按输入序输出（idsKey 稳定 → 画布 mergeLayout 不误判）
    expect(result.nodes[0].id).toBe('a');
  });

  it('截断后再裁边：两端都存活的边才保留', () => {
    const result = applyRenderCap(nodes, links, 2);
    // a、b 存活 → ab 存活；ac/ad 的 c、d 已被舍弃 → 裁掉；bc 的 c 被舍弃 → 裁掉
    expect(result.links.map((l) => l.id)).toEqual(['ab']);
  });

  it('孤立节点（度 0）在上限紧张时最先被舍弃', () => {
    const result = applyRenderCap(nodes, links, 1);
    expect(result.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('默认 cap=800：801 节点截到 800，800 节点不截', () => {
    const many = Array.from({ length: 801 }, (_, i) => namedNode(`n${i}`));
    const truncated = applyRenderCap(many, []);
    expect(truncated.capped).toBe(true);
    expect(truncated.nodes).toHaveLength(800);
    const exact = applyRenderCap(many.slice(0, 800), []);
    expect(exact.capped).toBe(false);
    expect(exact.nodes).toHaveLength(800);
  });
});

describe('computeFocusTransform 搜索定位变换', () => {
  it('pan 满足 pan + pos × zoom = center（目标点落到视口中心）', () => {
    const { pan, zoom } = computeFocusTransform({ x: 120, y: 80 }, { x: 500, y: 320 });
    expect(pan.x + 120 * zoom).toBeCloseTo(500, 10);
    expect(pan.y + 80 * zoom).toBeCloseTo(320, 10);
  });

  it('默认 zoom 为 1.2（计划约定的聚焦倍率）', () => {
    expect(computeFocusTransform({ x: 0, y: 0 }, { x: 500, y: 320 }).zoom).toBe(1.2);
  });

  it('可指定 zoom，pan 随之缩放', () => {
    const { pan, zoom } = computeFocusTransform({ x: 100, y: 100 }, { x: 500, y: 320 }, 1);
    expect(zoom).toBe(1);
    expect(pan).toEqual({ x: 400, y: 220 });
  });

  it('目标点已在中心且 zoom=1 时 pan 归零（不平移）', () => {
    const { pan } = computeFocusTransform({ x: 500, y: 320 }, { x: 500, y: 320 }, 1);
    expect(pan.x).toBeCloseTo(0, 10);
    expect(pan.y).toBeCloseTo(0, 10);
  });
});

describe('buildExportLegend 导出图例', () => {
  const legend = buildExportLegend();

  it('共 7 条：5 类节点 + 实线 + 虚线两关系线型', () => {
    expect(legend).toHaveLength(7);
  });

  it('含全部五类节点中文标签（与画布配色一一对应）', () => {
    for (const type of ['文献', '人物', '概念', '设备', '术语'] as const) {
      expect(legend).toContain(type);
    }
    expect(NODE_TYPE_LABEL).toBeTruthy();
  });

  it('线型条目以「实线：」「虚线：」开头（画布据此画线段而非圆点）', () => {
    const solid = legend.find((item) => item.startsWith('实线：'));
    const dashed = legend.find((item) => item.startsWith('虚线：'));
    expect(solid).toBeTruthy();
    expect(dashed).toBeTruthy();
    expect(solid).toContain('包含');
    expect(dashed).toContain('引用');
  });
});
