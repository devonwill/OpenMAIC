import { nanoid } from 'nanoid';
import {
  knowledgeBundleSchema,
  type KnowledgeBundleV2,
  type KnowledgeDocumentMeta,
  type KnowledgeNode,
  type KnowledgeNodeType,
} from './schema';

export const newDocumentId = () => `doc_${nanoid(10)}`;
export const newNodeId = () => `nd_${nanoid(10)}`;
export const newLinkId = () => `lnk_${nanoid(10)}`;

const normName = (name: string) => name.trim().toLowerCase();
const iso = () => new Date().toISOString();

export function createEmptyLibrary(input: {
  id: string; title: string; description?: string; ownerId: string; now?: string;
}): KnowledgeBundleV2 {
  const now = input.now ?? iso();
  return {
    version: 2, id: input.id, title: input.title.trim(), description: input.description?.trim() ?? '',
    kind: 'paper', reviewStatus: 'unreviewed', ownerId: input.ownerId,
    nodes: [], links: [], crossRefs: [], documents: [], createdAt: now, updatedAt: now,
  };
}

type Link = KnowledgeBundleV2['links'][number];

function pruneLinks(bundle: KnowledgeBundleV2): KnowledgeBundleV2 {
  const ids = new Set(bundle.nodes.map((n) => n.id));
  return {
    ...bundle,
    links: bundle.links.filter((l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target),
    crossRefs: bundle.crossRefs.filter((r) => ids.has(r.node)),
  };
}

function recalcDocuments(bundle: KnowledgeBundleV2): KnowledgeBundleV2 {
  return {
    ...bundle,
    documents: bundle.documents.map((d) => ({
      ...d,
      nodeCount: bundle.nodes.filter((n) => (n.documentIds ?? []).includes(d.id)).length,
    })),
  };
}

/** 把一次抽取产物（单文档）并入资料库：同名归一、边补 id、去重。 */
export function mergeExtractionIntoLibrary(
  library: KnowledgeBundleV2,
  extracted: KnowledgeBundleV2,
  meta: {
    documentId: string;
    filename: string;
    title: string;
    now?: string;
    sha256?: string;
    /** 文档原文，随文档元信息一并入库，供文档页查看/编辑。 */
    content?: string;
  },
): { bundle: KnowledgeBundleV2; document: KnowledgeDocumentMeta } {
  const now = meta.now ?? iso();
  const nodes = [...library.nodes];
  const byName = new Map(nodes.map((n) => [normName(n.name), n]));

  for (const incoming of extracted.nodes) {
    const existing = byName.get(normName(incoming.name));
    if (existing) {
      if (!existing.documentIds) existing.documentIds = [];
      if (!existing.documentIds.includes(meta.documentId)) existing.documentIds.push(meta.documentId);
      if (incoming.content.length > existing.content.length) existing.content = incoming.content;
      if (existing.category === '知识点' && incoming.category !== '知识点') existing.category = incoming.category;
      if (existing.nodeType === 'concept' && incoming.nodeType === 'term') existing.nodeType = 'term';
      for (const alias of incoming.aliases) {
        if (!existing.aliases.includes(alias) && existing.aliases.length < 30) existing.aliases.push(alias);
      }
      continue;
    }
    const node: KnowledgeNode = {
      ...incoming,
      id: newNodeId(),
      nodeType: incoming.nodeType,
      documentIds: [meta.documentId],
      attributes: {},
    };
    nodes.push(node);
    byName.set(normName(node.name), node);
  }

  // 用名称映射重建抽取边（抽取产物的 id 是临时的）
  const links: Link[] = [...library.links];
  const seen = new Set(links.map((l) => `${l.source}|${l.target}|${l.relation}`));
  for (const raw of extracted.links) {
    const s = byName.get(normName(extracted.nodes.find((n) => n.id === raw.source)?.name ?? ''));
    const t = byName.get(normName(extracted.nodes.find((n) => n.id === raw.target)?.name ?? ''));
    if (!s || !t || s.id === t.id) continue;
    const key = `${s.id}|${t.id}|${raw.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ id: newLinkId(), source: s.id, target: t.id, relation: raw.relation });
  }

  const document: KnowledgeDocumentMeta = {
    id: meta.documentId, title: meta.title, filename: meta.filename,
    ...(meta.sha256 ? { sha256: meta.sha256 } : {}),
    ...(meta.content !== undefined ? { content: meta.content } : {}),
    uploadedAt: now, nodeCount: 0,
  };
  let out: KnowledgeBundleV2 = {
    ...library, nodes, links,
    documents: [...library.documents, document],
    reviewStatus: 'unreviewed', updatedAt: now,
  };
  out = recalcDocuments(out);
  return { bundle: knowledgeBundleSchema.parse(out) as KnowledgeBundleV2, document: out.documents.at(-1)! };
}

/** 删文档联动：孤点删除、共享节点摘属、悬空边清理、重置审核。 */
export function removeDocumentFromLibrary(
  library: KnowledgeBundleV2, documentId: string, now?: string,
): { bundle: KnowledgeBundleV2 } {
  const survivors = library.nodes
    .map((n) => ({ ...n, documentIds: (n.documentIds ?? []).filter((d) => d !== documentId) }))
    .filter((n) => {
      // 手动节点（原库中 documentIds 为空）保留；自动节点摘掉归属后变孤点 → 删除
      const wasManual = (library.nodes.find((o) => o.id === n.id)?.documentIds?.length ?? 0) === 0;
      return wasManual || n.documentIds.length > 0;
    });
  let out: KnowledgeBundleV2 = {
    ...library,
    nodes: survivors,
    documents: library.documents.filter((d) => d.id !== documentId),
    reviewStatus: 'unreviewed',
    updatedAt: now ?? iso(),
  };
  out = recalcDocuments(pruneLinks(out));
  return { bundle: knowledgeBundleSchema.parse(out) as KnowledgeBundleV2 };
}

/**
 * 重新抽取联动：先摘除该文档的既有贡献（手动节点与其他文档共享的节点保留，
 * 仅由该文档产生的节点删除），再并入新抽取产物，重建边、清除 stale 标记、
 * 重算节点计数并重置审核状态；文档条目本身保留（原文与上传时间不变）。
 */
export function replaceDocumentExtraction(
  library: KnowledgeBundleV2,
  documentId: string,
  extracted: KnowledgeBundleV2,
  now?: string,
): { bundle: KnowledgeBundleV2 } {
  const at = now ?? iso();
  const doc = library.documents.find((d) => d.id === documentId);
  if (!doc) throw new Error('文档不存在');

  // 1) 摘除该文档贡献：手动新增的节点与仍被其他文档共享的节点保留，其余删除
  const survivors = library.nodes
    .map((n) => ({ ...n, documentIds: (n.documentIds ?? []).filter((d) => d !== documentId) }))
    .filter((n, index) => {
      const original = library.nodes[index].documentIds ?? [];
      return (
        n.source.locator === '手动新增' ||
        !original.includes(documentId) ||
        (n.documentIds?.length ?? 0) > 0
      );
    });
  const aliveIds = new Set(survivors.map((n) => n.id));
  const base: KnowledgeBundleV2 = {
    ...library,
    nodes: survivors,
    links: library.links.filter((l) => aliveIds.has(l.source) && aliveIds.has(l.target) && l.source !== l.target),
    crossRefs: library.crossRefs.filter((r) => aliveIds.has(r.node)),
    // 先移除本篇文档条目，交由 merge 按新抽取追加（原文/sha256 沿用）
    documents: library.documents.filter((d) => d.id !== documentId),
  };

  // 2) 并入新抽取（按名合并：重新认领的节点整体用新内容刷新，共享节点保守合并）
  const merged = mergeExtractionIntoLibrary(base, extracted, {
    documentId,
    filename: doc.filename,
    title: doc.title,
    now: at,
    ...(doc.sha256 ? { sha256: doc.sha256 } : {}),
    ...(doc.content !== undefined ? { content: doc.content } : {}),
  });

  // 3) 恢复上传时间、清除 stale、重算节点计数并重置审核
  const documents = merged.bundle.documents.map((d) =>
    d.id === documentId ? { ...d, uploadedAt: doc.uploadedAt, stale: false } : d,
  );
  const out = recalcDocuments({
    ...merged.bundle,
    documents,
    reviewStatus: 'unreviewed',
    updatedAt: at,
  });
  return { bundle: knowledgeBundleSchema.parse(out) as KnowledgeBundleV2 };
}

export interface NodeDraft {
  name: string; category: string; content: string;
  nodeType: KnowledgeNodeType; attributes: Record<string, string>;
}

function touch(bundle: KnowledgeBundleV2, now?: string): KnowledgeBundleV2 {
  return { ...bundle, reviewStatus: 'unreviewed', updatedAt: now ?? iso() };
}
function parseV2(bundle: KnowledgeBundleV2): KnowledgeBundleV2 {
  return knowledgeBundleSchema.parse(bundle) as KnowledgeBundleV2;
}

export function upsertNode(bundle: KnowledgeBundleV2, draft: NodeDraft, now?: string, nodeId?: string) {
  const name = draft.name.trim();
  if (!name) throw new Error('节点名称不能为空');
  const duplicate = bundle.nodes.some((n) => n.name.trim() === name && n.id !== nodeId);
  if (duplicate) throw new Error('已存在同名节点');
  if (nodeId) {
    const nodes = bundle.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, name, category: draft.category, content: draft.content, nodeType: draft.nodeType, attributes: draft.attributes }
        : n,
    );
    return { bundle: parseV2(touch({ ...bundle, nodes }, now)) };
  }
  const id = newNodeId();
  const node: KnowledgeNode = {
    id, name, aliases: [], category: draft.category, content: draft.content,
    nodeType: draft.nodeType, documentIds: [], attributes: draft.attributes,
    source: { title: bundle.title, locator: '手动新增' },
  };
  return { bundle: parseV2(touch({ ...bundle, nodes: [...bundle.nodes, node] }, now)), nodeId: id };
}

export function deleteNode(bundle: KnowledgeBundleV2, nodeId: string, now?: string) {
  return { bundle: parseV2(recalcDocuments(pruneLinks(touch({ ...bundle, nodes: bundle.nodes.filter((n) => n.id !== nodeId) }, now)))) };
}

export function addLink(bundle: KnowledgeBundleV2, source: string, target: string, relation: string, now?: string) {
  const rel = relation.trim();
  if (!rel) throw new Error('关系名不能为空');
  const ids = new Set(bundle.nodes.map((n) => n.id));
  if (!ids.has(source) || !ids.has(target)) throw new Error('关系端点不存在');
  if (source === target) throw new Error('不允许自连边');
  if (bundle.links.some((l) => l.source === source && l.target === target && l.relation === rel)) {
    throw new Error('该关系已存在');
  }
  return { bundle: parseV2(touch({ ...bundle, links: [...bundle.links, { id: newLinkId(), source, target, relation: rel }] }, now)) };
}

export function updateLink(bundle: KnowledgeBundleV2, linkId: string, relation: string, now?: string) {
  const rel = relation.trim();
  if (!rel) throw new Error('关系名不能为空');
  const links = bundle.links.map((l) => (l.id === linkId ? { ...l, relation: rel } : l));
  if (links.every((l) => l.id !== linkId)) throw new Error('关系不存在');
  return { bundle: parseV2(touch({ ...bundle, links }, now)) };
}

export function deleteLink(bundle: KnowledgeBundleV2, linkId: string, now?: string) {
  return { bundle: parseV2(touch({ ...bundle, links: bundle.links.filter((l) => l.id !== linkId) }, now)) };
}

/** FNV-1a 双轮（第二轮加盐）→ 16 个 hex，覆盖整串而非前缀截断，跨端可用（不依赖 Buffer/crypto）。 */
function hash16(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0xdeadbeef;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x01000197) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * 为存量无 id 的边补确定性 id（不写盘，供编辑期使用）。
 * 同时修复盘上已落盘的重复 id：保留首次出现，其余按 `源|目标|关系` 重算；
 * 若重算仍与已用 id 冲突（完全相同的重复边），追加序号后缀消解。
 * 必须确定性：GET 返回的 id 要能被后续 PATCH updateLink/deleteLink 命中。
 */
export function ensureLinkIds(bundle: KnowledgeBundleV2): KnowledgeBundleV2 {
  const used = new Set<string>();
  return {
    ...bundle,
    links: bundle.links.map((l) => {
      let id = l.id;
      if (!id || used.has(id)) id = `lnk_${hash16(`${l.source}|${l.target}|${l.relation}`)}`;
      let suffix = 1;
      const base = id;
      while (used.has(id)) id = `${base}_${suffix++}`;
      used.add(id);
      return id === l.id ? l : { ...l, id };
    }),
  };
}
