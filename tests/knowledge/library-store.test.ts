import { describe, expect, it } from 'vitest';
import {
  createEmptyLibrary, mergeExtractionIntoLibrary, removeDocumentFromLibrary,
  replaceDocumentExtraction,
  upsertNode, deleteNode, addLink, updateLink, deleteLink, ensureLinkIds,
} from '@/lib/knowledge/library-store';
import { upgradeBundleToV2, type KnowledgeBundle, type KnowledgeBundleV2 } from '@/lib/knowledge/schema';

const NOW = '2026-09-25T01:00:00.000Z';
function extracted(over: Partial<KnowledgeBundle> = {}): KnowledgeBundleV2 {
  return upgradeBundleToV2(
    {
      version: 1, id: 'tmp', title: 't', kind: 'paper', reviewStatus: 'unreviewed', ownerId: 'me',
      nodes: [
        { id: 'a', name: '雅可比矩阵', aliases: [], category: '术语', content: '速度映射', nodeType: 'term', documentIds: ['doc_x'], attributes: {}, source: { title: 't', locator: '片段 1' } },
        { id: 'b', name: '奇异位形', aliases: [], category: '概念', content: '失秩', nodeType: 'concept', documentIds: ['doc_x'], attributes: {}, source: { title: 't', locator: '片段 1' } },
      ],
      links: [{ source: 'a', target: 'b', relation: '相关' }],
      crossRefs: [],
    } as KnowledgeBundle,
    NOW,
  );
}

describe('library-store', () => {
  it('createEmptyLibrary 产出空 v2 库', () => {
    const lib = createEmptyLibrary({ id: 'lib-1', title: '机器人学', description: 'd', ownerId: 'me', now: NOW });
    expect(lib.version).toBe(2);
    expect(lib.reviewStatus).toBe('unreviewed');
    expect(lib.documents).toEqual([]);
    expect(lib.description).toBe('d');
  });

  it('合并首篇文档：节点带新 documentId、边生成 id', () => {
    const lib = createEmptyLibrary({ id: 'lib-1', title: '机器人学', ownerId: 'me', now: NOW });
    const out = mergeExtractionIntoLibrary(lib, extracted(), { documentId: 'doc_1', filename: 'a.md', title: 'A', now: NOW });
    expect(out.bundle.nodes).toHaveLength(2);
    expect(out.bundle.nodes.every((n) => (n.documentIds ?? []).includes('doc_1'))).toBe(true);
    expect(out.bundle.links[0].id).toMatch(/^lnk_/);
    expect(out.bundle.documents[0].nodeCount).toBe(2);
  });

  it('合并第二篇：同名术语归一、documentIds 追加、不产生重复节点', () => {
    let lib = createEmptyLibrary({ id: 'lib-1', title: '机器人学', ownerId: 'me', now: NOW });
    lib = mergeExtractionIntoLibrary(lib, extracted(), { documentId: 'doc_1', filename: 'a.md', title: 'A', now: NOW }).bundle;
    const second = extracted();
    second.nodes.push({ ...second.nodes[0], id: 'c', name: '阻尼最小二乘法', nodeType: 'term', documentIds: ['doc_y'] });
    const out = mergeExtractionIntoLibrary(lib, second, { documentId: 'doc_2', filename: 'b.md', title: 'B', now: NOW });
    const jac = out.bundle.nodes.filter((n) => n.name === '雅可比矩阵');
    expect(jac).toHaveLength(1);
    expect(jac[0]!.documentIds!.sort()).toEqual(['doc_1', 'doc_2']);
    expect(out.bundle.nodes).toHaveLength(3);
    expect(out.bundle.reviewStatus).toBe('unreviewed');
  });

  it('删文档：仅属该文档的节点删除、共享节点保留、悬空边清理、状态重置', () => {
    let lib = createEmptyLibrary({ id: 'lib-1', title: '机器人学', ownerId: 'me', now: NOW });
    lib = mergeExtractionIntoLibrary(lib, extracted(), { documentId: 'doc_1', filename: 'a.md', title: 'A', now: NOW }).bundle;
    const second = extracted();
    second.nodes.push({ ...second.nodes[0], id: 'c', name: '阻尼最小二乘法', nodeType: 'term', documentIds: ['doc_y'] });
    lib = mergeExtractionIntoLibrary(lib, second, { documentId: 'doc_2', filename: 'b.md', title: 'B', now: NOW }).bundle;
    lib.reviewStatus = 'reviewed';
    const out = removeDocumentFromLibrary(lib, 'doc_2', NOW);
    expect(out.bundle.documents.find((d) => d.id === 'doc_2')).toBeUndefined();
    expect(out.bundle.nodes.find((n) => n.name === '阻尼最小二乘法')).toBeUndefined();
    expect(out.bundle.nodes.find((n) => n.name === '雅可比矩阵')?.documentIds).toEqual(['doc_1']);
    expect(out.bundle.reviewStatus).toBe('unreviewed');
  });
});

describe('replaceDocumentExtraction', () => {
  const ORIGINAL_UPLOAD = '2026-09-01T00:00:00.000Z';

  /** 已合并 doc_1 且被标记「来源已变更」的库（文档条目 stale=true，审核态 reviewed） */
  function libWithStaleDoc() {
    let lib = createEmptyLibrary({ id: 'lib-1', title: '机器人学', ownerId: 'me', now: NOW });
    lib = mergeExtractionIntoLibrary(lib, extracted(), { documentId: 'doc_1', filename: 'a.md', title: 'A', now: NOW }).bundle;
    lib = {
      ...lib,
      reviewStatus: 'reviewed',
      documents: lib.documents.map((d) =>
        d.id === 'doc_1' ? { ...d, stale: true, uploadedAt: ORIGINAL_UPLOAD } : d,
      ),
    };
    return lib;
  }

  /** 重新抽取产物：不含「奇异位形」，且「雅可比矩阵」内容已修订 */
  function reExtracted() {
    const bundle = extracted();
    bundle.nodes = [
      { ...bundle.nodes[0]!, content: '修订后的速度映射', aliases: ['J 矩阵'] },
      { id: 'nd_new', name: '旋量', aliases: [], category: '术语', content: '指数积参数', nodeType: 'term', documentIds: ['doc_z'], attributes: {}, source: { title: 't', locator: '片段 9' } },
    ];
    bundle.links = [{ source: 'a', target: 'nd_new', relation: '相关' }];
    return bundle;
  }

  it('重抽：旧节点替换为新内容、stale 清除、上传时间保留、审核与计数重算', () => {
    const lib = libWithStaleDoc();
    const out = replaceDocumentExtraction(lib, 'doc_1', reExtracted(), NOW).bundle;
    const doc = out.documents.find((d) => d.id === 'doc_1')!;
    expect(doc.stale).toBe(false);
    expect(doc.uploadedAt).toBe(ORIGINAL_UPLOAD);
    expect(out.reviewStatus).toBe('unreviewed');
    // 新内容覆盖、旧抽取产物（不在新结果中的节点）被摘除、新节点并入
    expect(out.nodes.find((n) => n.name === '雅可比矩阵')?.content).toBe('修订后的速度映射');
    expect(out.nodes.find((n) => n.name === '旋量')).toBeDefined();
    expect(out.nodes.find((n) => n.name === '奇异位形')).toBeUndefined();
    // 边无悬空端点，节点计数已按归属重算
    const ids = new Set(out.nodes.map((n) => n.id));
    expect(out.links.every((l) => ids.has(l.source) && ids.has(l.target))).toBe(true);
    expect(doc.nodeCount).toBe(out.nodes.filter((n) => (n.documentIds ?? []).includes('doc_1')).length);
  });

  it('重抽 doc_1：被 doc_2 共享的节点保留且归属不丢', () => {
    let lib = libWithStaleDoc();
    const second = extracted();
    second.nodes.push({ ...second.nodes[0], id: 'c', name: '阻尼最小二乘法', nodeType: 'term', documentIds: ['doc_y'] });
    lib = mergeExtractionIntoLibrary(lib, second, { documentId: 'doc_2', filename: 'b.md', title: 'B', now: NOW }).bundle;
    const out = replaceDocumentExtraction(lib, 'doc_1', reExtracted(), NOW).bundle;
    const jac = out.nodes.find((n) => n.name === '雅可比矩阵');
    expect(jac).toBeDefined();
    expect(jac?.documentIds).toContain('doc_2');
    expect(jac?.documentIds).toContain('doc_1'); // 新抽取重新认领
    // doc_2 独有节点不受影响
    expect(out.nodes.find((n) => n.name === '阻尼最小二乘法')).toBeDefined();
  });

  it('重抽：手动新增节点保留，指向被摘除节点的悬空边被裁剪', () => {
    let lib = libWithStaleDoc();
    const created = upsertNode(lib, { name: '压电陶瓷', category: '器件', content: '驱动材料', nodeType: 'term', attributes: {} }, NOW);
    lib = created.bundle;
    expect(lib.links).toHaveLength(1); // 原 a→b 边
    const out = replaceDocumentExtraction(lib, 'doc_1', reExtracted(), NOW).bundle;
    const manual = out.nodes.find((n) => n.name === '压电陶瓷');
    expect(manual).toBeDefined();
    expect(manual?.documentIds).toEqual([]);
    // 原 a→b 边两端（b 已摘除、a 换新 id）均失效，只剩新抽取带来的 a→nd_new
    expect(out.links.every((l) => l.relation !== '相关' || true)).toBe(true);
    const ids = new Set(out.nodes.map((n) => n.id));
    expect(out.links.every((l) => ids.has(l.source) && ids.has(l.target))).toBe(true);
    expect(out.links).toHaveLength(1);
  });

  it('文档不存在时抛错', () => {
    const lib = libWithStaleDoc();
    expect(() => replaceDocumentExtraction(lib, 'doc_missing', reExtracted(), NOW)).toThrow('文档不存在');
  });
});

function libWithOneNode() {
  let lib = createEmptyLibrary({ id: 'lib-1', title: 'x', ownerId: 'me', now: NOW });
  return mergeExtractionIntoLibrary(lib, extracted(), { documentId: 'doc_1', filename: 'a.md', title: 'A', now: NOW }).bundle;
}

describe('graph edits', () => {
  it('新增手动节点（无文档归属）并连边', () => {
    const lib0 = libWithOneNode();
    const created = upsertNode(lib0, { name: '压电陶瓷', category: '器件', content: '驱动材料', nodeType: 'term', attributes: { 形变: '0.1%' } }, NOW);
    expect(created.bundle.nodes.at(-1)?.documentIds).toEqual([]);
    const targetId = created.bundle.nodes[0]!.id;
    const withLink = addLink(created.bundle, created.bundle.nodes.at(-1)!.id, targetId, '驱动', NOW);
    expect(withLink.bundle.links.at(-1)?.relation).toBe('驱动');
  });

  it('更新节点属性与改名', () => {
    const lib0 = libWithOneNode();
    const id = lib0.nodes[0]!.id;
    const out = upsertNode(lib0, { name: '雅可比矩阵 J', category: '术语', content: '改', nodeType: 'term', attributes: { 量纲: '混合' } }, NOW, id);
    const node = out.bundle.nodes.find((n) => n.id === id)!;
    expect(node.name).toBe('雅可比矩阵 J');
    expect(node.attributes).toEqual({ 量纲: '混合' });
    expect(out.bundle.reviewStatus).toBe('unreviewed');
  });

  it('删节点连带删边；改/删边按 linkId', () => {
    const lib0 = libWithOneNode();
    const linkId = lib0.links[0]!.id!;
    const renamed = updateLink(lib0, linkId, '导致', NOW);
    expect(renamed.bundle.links[0]!.relation).toBe('导致');
    const removedLink = deleteLink(renamed.bundle, linkId, NOW);
    expect(removedLink.bundle.links).toHaveLength(0);
    const removedNode = deleteNode(lib0, lib0.nodes[1]!.id, NOW);
    expect(removedNode.bundle.nodes).toHaveLength(1);
    expect(removedNode.bundle.links).toHaveLength(0);
  });

  it('连到不存在节点抛错；重名新增抛错', () => {
    const lib0 = libWithOneNode();
    expect(() => addLink(lib0, lib0.nodes[0]!.id, 'nd_missing', 'x', NOW)).toThrow();
    expect(() => upsertNode(lib0, { name: lib0.nodes[1]!.name, category: 'c', content: '', nodeType: 'concept', attributes: {} }, NOW)).toThrow();
  });
});

describe('ensureLinkIds', () => {
  // 回归：旧实现只截取 `${source}|${target}|${relation}` 前 16 个 hex（= 前 8 个
  // ASCII 字符），相同 source 前缀的边全部撞成同一个 id，导致 React key 重复。
  it('相同 source 前缀、不同 target/relation 的边各自拿到唯一 id', () => {
    const base = createEmptyLibrary({ id: 'lib-1', title: 't', ownerId: 'me', now: NOW });
    const lib: KnowledgeBundleV2 = {
      ...base,
      nodes: [
        { id: 'k1-link-a', name: 'A', aliases: [], category: 'c', content: '', nodeType: 'concept', documentIds: ['d1'], attributes: {}, source: { title: 't', locator: 's' } },
        { id: 'k1-link-b', name: 'B', aliases: [], category: 'c', content: '', nodeType: 'concept', documentIds: ['d1'], attributes: {}, source: { title: 't', locator: 's' } },
        { id: 'k1-link-c', name: 'C', aliases: [], category: 'c', content: '', nodeType: 'concept', documentIds: ['d1'], attributes: {}, source: { title: 't', locator: 's' } },
      ],
      links: [
        { source: 'k1-link-a', target: 'k1-link-b', relation: '相关' },
        { source: 'k1-link-a', target: 'k1-link-c', relation: '相关' },
        { source: 'k1-link-a', target: 'k1-link-b', relation: '导致' },
        { source: 'k1-link-b', target: 'k1-link-c', relation: '相关' },
      ],
    };
    const out = ensureLinkIds(lib);
    const ids = out.links.map((l) => l.id!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^lnk_/.test(id))).toBe(true);
    // 确定性：两次调用结果一致（GET 返回的 id 必须能被后续 PATCH 命中）
    expect(ensureLinkIds(lib).links.map((l) => l.id)).toEqual(ids);
  });

  it('修复盘上已落盘的重复显式 id（保留首个，其余重新分配且唯一）', () => {
    const base = createEmptyLibrary({ id: 'lib-1', title: 't', ownerId: 'me', now: NOW });
    const dup = 'lnk_6b39302d6e7c6b39';
    const lib: KnowledgeBundleV2 = {
      ...base,
      nodes: [
        { id: 'nd_x', name: 'X', aliases: [], category: 'c', content: '', nodeType: 'concept', documentIds: ['d1'], attributes: {}, source: { title: 't', locator: 's' } },
        { id: 'nd_y', name: 'Y', aliases: [], category: 'c', content: '', nodeType: 'concept', documentIds: ['d1'], attributes: {}, source: { title: 't', locator: 's' } },
        { id: 'nd_z', name: 'Z', aliases: [], category: 'c', content: '', nodeType: 'concept', documentIds: ['d1'], attributes: {}, source: { title: 't', locator: 's' } },
      ],
      links: [
        { id: dup, source: 'nd_x', target: 'nd_y', relation: '相关' },
        { id: dup, source: 'nd_x', target: 'nd_z', relation: '相关' },
        { id: dup, source: 'nd_x', target: 'nd_y', relation: '导致' },
      ],
    };
    const out = ensureLinkIds(lib);
    const ids = out.links.map((l) => l.id!);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(dup); // 首个显式 id 保持不变，前端已有引用不受影响
    // 确定性：重复调用仍得到同一组 id
    expect(ensureLinkIds(out).links.map((l) => l.id)).toEqual(ids);
  });
});
