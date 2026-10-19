/**
 * 引用可追溯闭环（P0-2）：把生成正文里的 citation 标记与真实知识库比对。
 *
 * 生成时 prompt 要求模型保留 `[知识来源:bundleId/nodeId]` 标记，但模型
 * 可能编造不存在的 bundle/node、引用未审核的包、或越过图2 的勾选范围。
 * 本模块只做纯函数比对（bundles 由调用方从磁盘加载），审计结果挂在
 * scene.citationAudit 上，课堂画布据此展示“本页引用清单”，无效项标红。
 */

import type { KnowledgeBundle } from './schema';

/** 一条可追溯到知识库节点的有效引用。 */
export interface CitationRef {
  /** 正文中的原始标记，如 `[知识来源:robotics/fk]`。 */
  citation: string;
  bundleId: string;
  bundleTitle: string;
  nodeId: string;
  nodeName: string;
}

/**
 * 无效原因：
 * - not-found：引用的 bundle 或 node 在知识库中不存在（模型编造）。
 * - not-reviewed：bundle 存在但未通过审核（demo/unreviewed 不算权威来源）。
 * - out-of-scope：bundle 存在但不在图2 勾选的检索范围内。
 */
export type CitationInvalidReason = 'not-found' | 'not-reviewed' | 'out-of-scope';

export interface CitationIssue {
  citation: string;
  bundleId: string;
  nodeId: string;
  reason: CitationInvalidReason;
}

export interface CitationAudit {
  /** 正文中出现的 citation 总数（去重后）。 */
  total: number;
  valid: CitationRef[];
  invalid: CitationIssue[];
}

/** 与 retrieval.ts 生成的 citation 标记严格同格式。 */
const CITATION_PATTERN = /\[知识来源:([^\]]+)\]/g;

/** 从任意文本中抽取 citation 标记，去重且保持出现顺序。 */
export function extractCitations(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const raw = match[0];
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

function splitCitation(raw: string): { bundleId: string; nodeId: string } | null {
  const inner = raw.slice('[知识来源:'.length, -1);
  // bundleId 不含 `/`（schema 正则 [a-zA-Z0-9_-]），node id 理论上可以含，
  // 因此只按第一个 `/` 切分。
  const sep = inner.indexOf('/');
  if (sep <= 0 || sep === inner.length - 1) return null;
  return { bundleId: inner.slice(0, sep), nodeId: inner.slice(sep + 1) };
}

/**
 * 比对一页文本中的全部 citation 与真实知识库。
 *
 * `bundleIds` 语义与检索侧一致：空/未传 = 不限范围（全库已审核检索），
 * 非空 = 图2 的勾选范围，越界引用判为 out-of-scope。0 条 citation 返回
 * 空审计（total: 0），前端不渲染角标——“没有引用”不等于“引用违规”。
 */
export function auditSceneCitations(
  bundles: KnowledgeBundle[],
  text: string,
  bundleIds?: string[],
): CitationAudit {
  const byId = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  const scope = bundleIds?.length ? new Set(bundleIds) : null;
  const valid: CitationRef[] = [];
  const invalid: CitationIssue[] = [];

  for (const citation of extractCitations(text)) {
    const parsed = splitCitation(citation);
    if (!parsed) {
      invalid.push({ citation, bundleId: '', nodeId: '', reason: 'not-found' });
      continue;
    }
    const bundle = byId.get(parsed.bundleId);
    const node = bundle?.nodes.find((item) => item.id === parsed.nodeId);
    if (!bundle || !node) {
      invalid.push({ ...parsed, citation, reason: 'not-found' });
      continue;
    }
    if (bundle.reviewStatus !== 'reviewed') {
      invalid.push({ ...parsed, citation, reason: 'not-reviewed' });
      continue;
    }
    if (scope && !scope.has(bundle.id)) {
      invalid.push({ ...parsed, citation, reason: 'out-of-scope' });
      continue;
    }
    valid.push({
      citation,
      bundleId: bundle.id,
      bundleTitle: bundle.title,
      nodeId: node.id,
      nodeName: node.name,
    });
  }

  return { total: valid.length + invalid.length, valid, invalid };
}
