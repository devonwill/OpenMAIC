import { z } from 'zod';

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
  source,
});
export const knowledgeBundleSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    title: z.string().min(1).max(300),
    kind: z.enum(['graph', 'paper']),
    reviewStatus: z.enum(['unreviewed', 'reviewed', 'demo']),
    nodes: z.array(knowledgeNodeSchema).max(10000),
    links: z
      .array(
        z.object({
          source: z.string().min(1).max(180),
          target: z.string().min(1).max(180),
          relation: z.string().min(1).max(200),
        }),
      )
      .max(30000),
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
  });
export type KnowledgeBundle = z.infer<typeof knowledgeBundleSchema>;
export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>;
export interface KnowledgeHit {
  bundleId: string;
  bundleTitle: string;
  reviewStatus: KnowledgeBundle['reviewStatus'];
  node: KnowledgeNode;
  score: number;
  relations: { source: string; target: string; relation: string }[];
}
