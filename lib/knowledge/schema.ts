import { z } from 'zod';

/** 节点类型五类；老数据缺省由 .default('concept') 兜底，无需迁移。 */
export const KNOWLEDGE_NODE_TYPES = ['literature', 'person', 'concept', 'device', 'term'] as const;
export type KnowledgeNodeType = (typeof KNOWLEDGE_NODE_TYPES)[number];

/** 关键词 → 线型；按声明序子串匹配，多命中取先者，未知默认实线。 */
export const LINK_STYLE: Record<string, 'solid' | 'dashed'> = {
  // 结构/归属类：实线
  包含: 'solid',
  属于: 'solid',
  定义: 'solid',
  组成: 'solid',
  // 引用/关联类：虚线
  引用: 'dashed',
  参考: 'dashed',
  关联: 'dashed',
  相关: 'dashed',
  推导: 'dashed',
  导致: 'dashed',
  指示: 'dashed',
};

export function linkLineStyle(relation: string): 'solid' | 'dashed' {
  for (const [keyword, style] of Object.entries(LINK_STYLE)) {
    if (relation.includes(keyword)) return style;
  }
  return 'solid';
}

const source = z.object({
  title: z.string().min(1).max(300),
  locator: z.string().max(500),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const knowledgeNodeSchema = z.object({
  id: z.string().min(1).max(180),
  name: z.string().min(1).max(300),
  aliases: z.array(z.string().min(1).max(200)).max(30).default([]),
  category: z.string().max(100).default('知识点'),
  content: z.string().max(16000),
  /** literature=文献；person=人物；concept=概念；device=设备；term=术语。 */
  nodeType: z.enum(KNOWLEDGE_NODE_TYPES).default('concept'),
  /** 节点由哪些文档抽取而来；同名节点跨文档合并时追加；手动节点为 []。 */
  documentIds: z.array(z.string().min(1).max(120)).max(200).default([]),
  /** 手动维护的自定义属性键值对，最多 20 对。 */
  attributes: z
    .record(z.string().max(80), z.string().max(500))
    .refine((record) => Object.keys(record).length <= 20, {
      message: '自定义属性最多 20 个',
    })
    .default({}),
  // 老数据/手工包可能缺 source；补占位来源而非整包拒绝，
  // 否则一个节点缺字段会连带同包其余合法节点一起被跳过。
  source: source.default({ title: '未标注来源', locator: '' }),
});
export const knowledgeLinkSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  source: z.string().min(1).max(180),
  target: z.string().min(1).max(180),
  relation: z.string().min(1).max(200),
});
export const knowledgeDocumentSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  filename: z.string().min(1).max(300),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  uploadedAt: z.string().min(1).max(40),
  nodeCount: z.number().int().min(0),
  /** 文档原文（上传时保留，供文档页查看/编辑）；旧数据无此字段。 */
  content: z.string().max(500_000).optional(),
  /** 原文已修改但尚未重新抽取，图谱节点可能与文档内容不一致。 */
  stale: z.boolean().optional(),
});
export interface KnowledgeDocumentMeta {
  id: string;
  title: string;
  filename: string;
  sha256?: string;
  uploadedAt: string;
  nodeCount: number;
  content?: string;
  stale?: boolean;
}
export const knowledgeBundleSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    title: z.string().min(1).max(300),
    kind: z.enum(['graph', 'paper', 'code']),
    // 缺省补最保守的 unreviewed：老数据/手工包可能不带该字段，
    // 若强制必填会让整包在 parse 阶段被丢弃；unreviewed 不会泄漏进课堂语料。
    reviewStatus: z.enum(['unreviewed', 'reviewed', 'demo']).default('unreviewed'),
    /**
     * Bundles without an ownerId are shared (pre-existing hand-authored files);
     * uploaded/indexed bundles carry the uploader's owner so mutations stay
     * scoped to that owner.
     */
    ownerId: z.string().min(1).max(120).optional(),
    visibility: z.enum(['private', 'public']).optional(),
    sharedWithUserIds: z.array(z.string().uuid()).max(100).optional(),
    nodes: z.array(knowledgeNodeSchema).max(10000),
    links: z.array(knowledgeLinkSchema).max(30000),
    /**
     * Cross-bundle edges (typically code → knowledge). Local `links` must stay
     * self-contained (validated below); targets here live in OTHER bundles, so
     * dangling targets are caught by the periodic referential check instead.
     */
    crossRefs: z
      .array(
        z.object({
          node: z.string().min(1).max(180),
          targetBundleId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
          targetNodeId: z.string().min(1).max(180),
          relation: z.string().min(1).max(200),
        }),
      )
      .max(5000)
      .default([]),
    description: z.string().max(500).default(''),
    createdAt: z.string().max(40).optional(),
    updatedAt: z.string().max(40).optional(),
    documents: z.array(knowledgeDocumentSchema).max(200).default([]),
  })
  .superRefine((bundle, ctx) => {
    const ids = new Set(bundle.nodes.map((node) => node.id));
    if (ids.size !== bundle.nodes.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate node IDs' });
    for (const link of bundle.links) {
      if (!ids.has(link.source) || !ids.has(link.target)) {
        ctx.addIssue({ code: 'custom', message: 'Relationship references a missing node' });
        break;
      }
    }
    for (const ref of bundle.crossRefs) {
      if (!ids.has(ref.node)) {
        ctx.addIssue({ code: 'custom', message: 'Cross reference starts at a missing node' });
        break;
      }
    }
  });

/**
 * v2 新增字段在 parse 时由 zod 补默认值（运行时必然存在），但导出类型保持可选，
 * 以兼容仓库中存量的手工构造点（如 lib/server/code-repo.ts 的符号节点字面量、
 * 测试 fixture）。经过 upgradeBundleToV2 后请使用 KnowledgeBundleV2，
 * 其 v2 字段均为必填。
 */
type InferredKnowledgeNode = z.infer<typeof knowledgeNodeSchema>;
export type KnowledgeNode = Omit<
  InferredKnowledgeNode,
  'nodeType' | 'documentIds' | 'attributes'
> & {
  nodeType?: InferredKnowledgeNode['nodeType'];
  documentIds?: InferredKnowledgeNode['documentIds'];
  attributes?: InferredKnowledgeNode['attributes'];
};
type InferredKnowledgeBundle = z.infer<typeof knowledgeBundleSchema>;
export type KnowledgeBundle = Omit<
  InferredKnowledgeBundle,
  'nodes' | 'description' | 'documents'
> & {
  nodes: KnowledgeNode[];
  description?: string;
  documents?: KnowledgeDocumentMeta[];
};
export type KnowledgeBundleV2 = KnowledgeBundle & {
  version: 1 | 2;
  description: string;
  createdAt?: string;
  updatedAt?: string;
  documents: KnowledgeDocumentMeta[];
};

/** v1 → v2 内存升级：合成 legacy 文档，节点补术语标记/归属/属性。幂等。 */
export function upgradeBundleToV2(
  bundle: KnowledgeBundle,
  fallbackIso: string,
): KnowledgeBundleV2 {
  if (bundle.version === 2 && Array.isArray(bundle.documents)) {
    return { ...bundle, version: 2, description: bundle.description ?? '', documents: bundle.documents };
  }
  const nodes = bundle.nodes.map((node) => ({
    ...node,
    nodeType: node.nodeType ?? 'concept',
    documentIds: node.documentIds?.length ? node.documentIds : ['doc_legacy'],
    attributes: node.attributes ?? {},
  }));
  return {
    ...bundle,
    version: 2,
    description: bundle.description ?? '',
    createdAt: bundle.createdAt ?? fallbackIso,
    updatedAt: bundle.updatedAt ?? fallbackIso,
    documents: [
      {
        id: 'doc_legacy',
        title: bundle.title,
        filename: `${bundle.id}.md`,
        uploadedAt: fallbackIso,
        nodeCount: nodes.length,
      },
    ],
    nodes,
  };
}
export interface KnowledgeHit {
  bundleId: string;
  bundleTitle: string;
  kind: KnowledgeBundle['kind'];
  reviewStatus: KnowledgeBundle['reviewStatus'];
  node: KnowledgeNode;
  score: number;
  relations: { source: string; target: string; relation: string }[];
  /**
   * 命中节点沿 links 的 1 跳邻居（未直接命中的关联知识点），检索时附加，
   * 为生成提供图谱上下文；已是命中的节点不重复收录。
   */
  neighbors?: { id: string; name: string; relation: string; content: string }[];
}
