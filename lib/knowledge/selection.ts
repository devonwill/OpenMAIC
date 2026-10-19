/**
 * 图1 知识库勾选的客户端持久化。
 *
 * 生成侧（scene-actions/outlines/content）与课堂问答侧（/api/chat、
 * /api/chat/pi）共用同一份勾选：首页勾选后写入 localStorage，聊天请求
 * 发出前读取，保证讨论环节的检索范围与课程生成时一致。未勾选时返回
 * 空列表，服务端按“未选择”处理（检索全部已审核知识库）。
 */

import type { KnowledgeQuota, KnowledgeSelection } from './quota';

const STORAGE_KEY = 'knowledgeSelection';

const EMPTY_SELECTION: KnowledgeSelection = { bundleIds: [] };

function clampPercentLike(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeQuota(value: unknown): KnowledgeQuota | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { local?: unknown; web?: unknown; model?: unknown };
  const local = clampPercentLike(raw.local);
  const web = clampPercentLike(raw.web);
  const model = clampPercentLike(raw.model);
  if (local === null && web === null && model === null) return null;
  // KnowledgeQuota 是三字段全量类型；UI 写入的配额总是齐全，这里仅对
  // 手动改写的数据补默认值（与选择面板默认 70/20 一致），最终仍由服务端
  // normalizeQuota 归一到总和 100。
  const localFinal = local ?? 70;
  const webFinal = web ?? 20;
  const modelFinal = model ?? Math.max(0, 100 - localFinal - webFinal);
  return { local: localFinal, web: webFinal, model: modelFinal };
}

/**
 * 容错解析任意载荷（localStorage 可能被旧版本或手动改写）：
 * 非字符串 id 一律丢弃，quota 缺失字段交由服务端 normalizeQuota 补全。
 */
export function sanitizeKnowledgeSelection(value: unknown): KnowledgeSelection {
  if (!value || typeof value !== 'object') return EMPTY_SELECTION;
  const raw = value as { bundleIds?: unknown; quota?: unknown };
  const bundleIds = Array.isArray(raw.bundleIds)
    ? raw.bundleIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    : [];
  const quota = sanitizeQuota(raw.quota);
  return { bundleIds, ...(quota ? { quota } : {}) };
}

/** 读取勾选；SSR、私有模式或数据损坏时返回空选择（= 旧行为，全库检索）。 */
export function readKnowledgeSelection(): KnowledgeSelection {
  if (typeof window === 'undefined') return EMPTY_SELECTION;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SELECTION;
    return sanitizeKnowledgeSelection(JSON.parse(raw));
  } catch {
    return EMPTY_SELECTION;
  }
}

/** 持久化勾选；写入失败（隐私模式/配额满）不阻断主流程。 */
export function storeKnowledgeSelection(selection: KnowledgeSelection): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // 忽略：下一次勾选可重试，聊天侧按未勾选回退全库检索。
  }
}
