/**
 * Three-route citation quota: how the final answer should split its
 * support across local knowledge (knowledge base + code repo), web
 * search, and the model's own parametric knowledge.
 *
 * The quota is an EVIDENCE/ Citation constraint, never a content blend:
 * retrieval only budgets the local route, the web route is governed by a
 * prompt instruction (the tool simply does not exist when web search is
 * unconfigured or offline), and the model route is the remainder.
 */

export interface KnowledgeQuota {
  /** 0-100, share of citations expected from local bundles. */
  local: number;
  /** 0-100, share of citations expected from web search. */
  web: number;
  /** 0-100, share left to the model's own knowledge. */
  model: number;
}

/** Local evidence pieces injected per prompt (maps to search top-N). */
export const DEFAULT_LOCAL_EVIDENCE_BUDGET = 4;

/**
 * 图2 picker output: the 知识库 bundles the user chose plus their
 * three-route citation quota. `quota` stays optional so an untouched
 * picker keeps yielding to the server env defaults.
 */
export interface KnowledgeSelection {
  bundleIds: string[];
  quota?: KnowledgeQuota;
}

function clampPercent(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

/**
 * Accepts `{local, web, model}` in any mix; missing parts fall back to
 * env defaults, and the result is normalized so the three shares sum to
 * 100 (model absorbs rounding when it was not pinned).
 */
export function normalizeQuota(input?: Partial<KnowledgeQuota> | null): KnowledgeQuota {
  const envLocal = clampPercent(process.env.KNOWLEDGE_QUOTA_LOCAL, 70);
  const envWeb = clampPercent(process.env.KNOWLEDGE_QUOTA_WEB, 20);
  const local = clampPercent(input?.local, envLocal);
  const web = clampPercent(input?.web, envWeb);
  let model =
    input?.model !== undefined && input?.model !== null
      ? clampPercent(input.model, 100 - local - web)
      : 100 - local - web;
  // All three explicitly zero is meaningless — restore the env default split.
  if (local === 0 && web === 0 && model === 0) {
    return { local: envLocal, web: envWeb, model: clampPercent(100 - envLocal - envWeb, 10) };
  }
  const total = local + web + model;
  if (total !== 100) {
    const delta = 100 - total;
    if (delta > 0) {
      // Under-total: model absorbs the remainder when it was not pinned.
      return { local, web, model: clampPercent(model + delta, 0) };
    }
    // Over-total (explicit model pinned too high): give the excess back to
    // web first, then local, so the three shares always sum to exactly 100.
    const giveBack = -delta;
    const fromWeb = Math.min(web, giveBack);
    const webOut = web - fromWeb;
    const fromLocal = Math.min(local, giveBack - fromWeb);
    const localOut = local - fromLocal;
    return { local: localOut, web: webOut, model: 100 - localOut - webOut };
  }
  return { local, web, model };
}

/**
 * Prompt block appended next to local evidence. Kept short and explicit so
 * the model treats the numbers as citation shares, not as writing ratios.
 * When `web` is 0 (offline / provider unconfigured) the instruction forbids
 * web citations outright, making the degraded path deterministic.
 */
export function buildQuotaInstruction(quota: KnowledgeQuota): string {
  const parts = [
    '',
    '引用配额（按证据来源控制引用占比，不是字面内容比例）：',
    `- 本地知识库与代码库引用占比约 ${quota.local}%（优先引用上方“参考知识数据”中的 citation 标记）。`,
  ];
  if (quota.web > 0) {
    parts.push(
      `- 联网内容引用占比不超过 ${quota.web}%（仅在已提供联网结果时引用，并标注来源 URL）。`,
    );
  } else {
    parts.push('- 本次禁止引用任何互联网内容；无本地证据时说明证据不足。');
  }
  parts.push(
    `- 其余约 ${quota.model}% 可基于模型自身知识，须明确标注【模型推断】，不得伪装成有据引用。`,
  );
  return `${parts.join('\n')}\n`;
}

export interface QuotaAudit {
  local: number;
  web: number;
  model: number;
  totalCitations: number;
  /** Local+web citation shares actually observed, 0-100 (when any citations exist). */
  observed: { local: number; web: number } | null;
  /** True when observed local share is at least half of the configured share. */
  compliant: boolean;
}

const LOCAL_CITATION_PATTERN = /\[知识来源:[^\]]+\]/g;
const WEB_CITATION_PATTERN = /https?:\/\/[^\s)\]}"']+/g;

/**
 * Post-generation audit: count local / web citations in the produced text.
 * Model share is the residual (claims without an external citation).
 * A piece with no citations at all reports `observed: null` instead of a
 * misleading 0/0 split — an all-model answer, not a quota violation.
 */
export function auditCitations(text: string, quota: KnowledgeQuota): QuotaAudit {
  const local = (text.match(LOCAL_CITATION_PATTERN) ?? []).length;
  const web = (text.match(WEB_CITATION_PATTERN) ?? []).length;
  const totalCitations = local + web;
  if (totalCitations === 0) {
    return { local, web, model: 0, totalCitations, observed: null, compliant: true };
  }
  const observedLocal = Math.round((local / totalCitations) * 100);
  const observedWeb = 100 - observedLocal;
  // Soft gate: flag only clear shortfalls (below half the configured share),
  // so a single extra URL does not mark the run non-compliant.
  const compliant = quota.local === 0 || observedLocal >= Math.floor(quota.local / 2);
  return {
    local,
    web,
    model: 0,
    totalCitations,
    observed: { local: observedLocal, web: observedWeb },
    compliant,
  };
}
