import type { UIMessage } from 'ai';
import { loadKnowledge } from './storage';
import { canReadKnowledge } from './access';
export { loadKnowledge } from './storage';
import { searchKnowledge, overviewHits, formatKnowledgeEvidence } from './retrieval';
import {
  buildQuotaInstruction,
  DEFAULT_LOCAL_EVIDENCE_BUDGET,
  normalizeQuota,
  type KnowledgeQuota,
} from './quota';

export interface ClassroomKnowledgeOptions {
  /** Server-resolved owner; absent means shared bundles only. */
  ownerId?: string;
  /** Restrict retrieval to these bundle ids (图2 的知识库多选). */
  bundleIds?: string[];
  /** Three-route citation quota; when present the prompt gets the quota block. */
  quota?: KnowledgeQuota;
  /** Local evidence top-N; defaults to the quota module's budget. */
  budget?: number;
}

export async function getClassroomKnowledge(
  query: string,
  options: ClassroomKnowledgeOptions = {},
): Promise<string> {
  if (process.env.KNOWLEDGE_CLASSROOM_ENABLED !== 'true' || !query.trim()) return '';
  try {
    const { bundles } = await loadKnowledge();
    let scoped = bundles.filter(
      (bundle) => bundle.reviewStatus === 'reviewed' && canReadKnowledge(bundle, options.ownerId),
    );
    // Selected 知识库 (bundle multi-select from 图2), when provided, narrow
    // retrieval; an empty selection list means "no selection made" → all.
    if (options.bundleIds?.length) {
      const wanted = new Set(options.bundleIds);
      scoped = scoped.filter((bundle) => wanted.has(bundle.id));
    }
    // Imported and demo content must never silently become authoritative classroom context.
    const budget = options.budget ?? DEFAULT_LOCAL_EVIDENCE_BUDGET;
    let hits = searchKnowledge(scoped, query, budget);
    // Explicitly checked libraries must always contribute evidence: when the
    // query shares no keyword with the selection (zero hits), fall back to
    // each selected bundle's most connected nodes instead of injecting
    // nothing — otherwise generation would ignore the checked knowledge.
    if (!hits.length && options.bundleIds?.length && scoped.length) {
      hits = overviewHits(scoped, budget);
    }
    const evidence = formatKnowledgeEvidence(hits);
    if (!evidence) return options.quota ? buildQuotaInstruction(normalizeQuota(options.quota)) : '';
    return evidence + (options.quota ? buildQuotaInstruction(normalizeQuota(options.quota)) : '');
  } catch {
    return '';
  } // Optional knowledge must not prevent an existing classroom from running.
}

/** Shared by the classic and Pi classroom routes. Leaves stored client messages intact. */
export async function attachClassroomKnowledge<T extends UIMessage>(
  messages: T[],
  options: ClassroomKnowledgeOptions = {},
): Promise<T[]> {
  const index = messages.findLastIndex((message) => message.role === 'user');
  if (index < 0) return messages;
  const parts = messages[index].parts ?? [];
  const question = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
  const evidence = await getClassroomKnowledge(question, options);
  if (!evidence) return messages;
  return messages.map((message, i) =>
    i === index
      ? { ...message, parts: [...parts, { type: 'text' as const, text: evidence }] }
      : message,
  );
}
