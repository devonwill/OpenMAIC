'use client';

import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeHit, KnowledgeNodeType } from '@/lib/knowledge/schema';

/** GET /api/knowledge → catalog[] 元素：资料库摘要。 */
export interface CatalogItem {
  id: string;
  title: string;
  kind: string;
  reviewStatus: string;
  ownerId?: string;
  canEdit?: boolean;
  visibility?: 'private' | 'public';
  sharedWithMe?: boolean;
  description: string;
  nodeCount: number;
  linkCount: number;
  documentCount: number;
  termCount: number;
}

/** GET /api/knowledge → documents[] 元素：资料库内文档元信息。 */
export interface DocMeta {
  id: string;
  title: string;
  filename: string;
  sha256?: string;
  uploadedAt: string;
  nodeCount: number;
  /** 原文已修改但尚未重新抽取（图谱可能与文档不一致）。 */
  stale?: boolean;
}

/** 浏览态图谱节点（GET 非 full）。 */
export interface BrowseNode {
  id: string;
  name: string;
  category: string;
}

/** 全量态图谱节点（GET ?full=1）。 */
export interface FullNode extends BrowseNode {
  nodeType: KnowledgeNodeType;
  attributes: Record<string, string>;
  documentIds: string[];
  content: string;
  aliases: string[];
}

/** 浏览态 / 全量态节点联合；消费方按 full 参数收窄。 */
export type GraphNode = BrowseNode | FullNode;

/** 图谱边（两种形态都带 id，浏览态 id 由服务端内存补齐）。 */
export interface FullLink {
  id: string;
  source: string;
  target: string;
  relation: string;
}

/** GET /api/knowledge → detail：全量字段加来源定位。 */
export interface NodeDetail extends FullNode {
  source: { title: string; locator: string };
}

export interface GraphBackendStatus {
  backend: 'neo4j' | 'json';
  configured: boolean;
  deployment: 'cloud' | 'local' | 'unknown';
  warning?: string;
}

export interface KnowledgeResponse {
  catalog: CatalogItem[];
  documents: DocMeta[];
  graph: { nodes: GraphNode[]; links: FullLink[] };
  hits: KnowledgeHit[];
  detail: NodeDetail | null;
  classroomEnabled: boolean;
  neo4jConfigured: boolean;
  graphBackend: GraphBackendStatus;
  integrity: { checked: number; issues: string[] };
  warnings: string[];
}

export interface UseKnowledgeParams {
  bundle?: string;
  q?: string;
  node?: string;
  full?: boolean;
  nonce?: number;
}

export interface UseKnowledgeResult {
  data: KnowledgeResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** 节点编辑草稿（对齐 library-store NodeDraft 与 PATCH upsertNode 契约）。 */
export interface NodeDraft {
  name: string;
  category: string;
  content: string;
  nodeType: KnowledgeNodeType;
  attributes: Record<string, string>;
}

/** POST /api/knowledge?libraryId=… → results[] 元素（与路由 UploadResult 一致）。 */
export type UploadResult =
  | { filename: string; ok: true; documentId: string; stats: { nodes: number; links: number } }
  | { filename: string; ok: false; error: string };

export type UploadItemStatus = 'waiting' | 'extracting' | 'done' | 'error';
export type UploadItemCallback = (
  index: number,
  status: UploadItemStatus,
  detail?: string,
) => void;

export interface SyncResult {
  synced?: boolean;
  backend?: string;
  created?: number;
  warning?: string;
}

/** GET /api/knowledge/neighbors → 响应体：Ego 子图 + 查询预览与降级信息。 */
export interface NeighborsResponse {
  nodes: FullNode[];
  links: FullLink[];
  cypherPreview: string;
  backend: 'neo4j' | 'json';
  warnings: string[];
}

function buildQuery(params: UseKnowledgeParams & { reloadNonce: number }): string {
  const search = new URLSearchParams();
  if (params.bundle) search.set('bundle', params.bundle);
  if (params.q) search.set('q', params.q);
  if (params.node) search.set('node', params.node);
  if (params.full) search.set('full', '1');
  const nonce = (params.nonce ?? 0) + params.reloadNonce;
  if (nonce > 0) search.set('t', String(nonce));
  return search.toString();
}

/** 拉取知识库数据（GET /api/knowledge，no-store）；参数或 nonce 变化自动重取。 */
export function useKnowledge(params: UseKnowledgeParams): UseKnowledgeResult {
  const [data, setData] = useState<KnowledgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const query = buildQuery({ ...params, reloadNonce });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/knowledge?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 401
              ? '请返回首页输入站点访问码，再打开知识库。'
              : '知识库加载失败',
          );
        }
        return (await response.json()) as KnowledgeResponse;
      })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : '知识库加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  const reload = useCallback(() => setReloadNonce((value) => value + 1), []);

  return { data, loading, error, reload };
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const error = (body as { error?: unknown }).error;
      if (typeof error === 'string' && error) return error;
    }
  } catch {
    // 响应体不是 JSON，使用通用错误文案
  }
  return fallback;
}

async function sendJson(input: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(input, {
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, `请求失败（HTTP ${response.status}）`));
  return response.json();
}

function isUploadResult(value: unknown, filename: string): value is UploadResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.filename !== filename) return false;
  if (candidate.ok === true)
    return (
      typeof candidate.documentId === 'string' &&
      typeof candidate.stats === 'object' &&
      candidate.stats !== null
    );
  return candidate.ok === false && typeof candidate.error === 'string';
}

export const knowledgeApi = {
  /** POST createLibrary → { id, title }。 */
  async createLibrary(title: string, description: string): Promise<{ id: string }> {
    const body = (await sendJson('/api/knowledge', {
      method: 'POST',
      body: JSON.stringify({ action: 'createLibrary', title, description }),
    })) as { id?: unknown };
    if (typeof body.id !== 'string') throw new Error('创建资料库失败：响应缺少 id');
    return { id: body.id };
  },

  /** POST updateLibrary：局部更新标题/描述。 */
  async updateLibrary(
    id: string,
    patch: { title?: string; description?: string },
  ): Promise<void> {
    await sendJson('/api/knowledge', {
      method: 'POST',
      body: JSON.stringify({ action: 'updateLibrary', id, ...patch }),
    });
  },

  /**
   * 串行逐文件上传到指定资料库（multipart 字段名 file，URL 带 libraryId）。
   * 单文件失败不抛错，结果经返回值与 onItem 回调呈现；网络级异常也归为该文件失败。
   */
  async uploadFiles(
    libraryId: string,
    files: File[],
    onItem?: UploadItemCallback,
  ): Promise<UploadResult[]> {
    const endpoint = `/api/knowledge?libraryId=${encodeURIComponent(libraryId)}`;
    const results: UploadResult[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file) continue;
      onItem?.(index, 'waiting');
      onItem?.(index, 'extracting');
      let result: UploadResult;
      try {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch(endpoint, { method: 'POST', body: form, cache: 'no-store' });
        if (!response.ok) {
          result = {
            filename: file.name,
            ok: false,
            error: await readErrorMessage(response, `上传失败（HTTP ${response.status}）`),
          };
        } else {
          const body = (await response.json()) as { results?: unknown };
          const first = Array.isArray(body.results) ? body.results[0] : undefined;
          result = isUploadResult(first, file.name)
            ? first
            : { filename: file.name, ok: false, error: '上传响应格式异常' };
        }
      } catch (reason) {
        result = {
          filename: file.name,
          ok: false,
          error: reason instanceof Error ? reason.message : '上传失败',
        };
      }
      results.push(result);
      if (result.ok) {
        onItem?.(
          index,
          'done',
          `已抽取 ${result.stats.nodes} 个知识点、${result.stats.links} 条关系`,
        );
      } else {
        onItem?.(index, 'error', result.error);
      }
    }
    return results;
  },

  /** DELETE 文档：联动删除仅由该文档产生的节点与悬空边。 */
  async deleteDocument(id: string, documentId: string): Promise<void> {
    await sendJson('/api/knowledge', {
      method: 'DELETE',
      body: JSON.stringify({ id, documentId }),
    });
  },

  /** GET 文档原文（?bundle=&document=）；旧数据未保存原文时返回 null。 */
  async getDocument(id: string, documentId: string): Promise<string | null> {
    const search = new URLSearchParams({ bundle: id, document: documentId });
    const response = await fetch(`/api/knowledge?${search}`, { cache: 'no-store' });
    if (!response.ok)
      throw new Error(await readErrorMessage(response, `读取文档失败（HTTP ${response.status}）`));
    const body = (await response.json()) as { document?: { content?: string | null } };
    return body.document?.content ?? null;
  },

  /** PATCH updateDocument：保存文档原文编辑；返回本次保存是否因内容变化标记了「来源已变更」。 */
  async updateDocument(id: string, documentId: string, content: string): Promise<{ stale: boolean }> {
    const body = (await sendJson('/api/knowledge', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'updateDocument', id, documentId, content }),
    })) as { stale?: unknown };
    return { stale: body.stale === true };
  },

  /** PATCH reextractDocument：按最新原文重新抽取并回写图谱，返回抽取统计。 */
  async reextractDocument(
    id: string,
    documentId: string,
  ): Promise<{ stats: { nodes: number; links: number }; warnings: string[] }> {
    const body = (await sendJson('/api/knowledge', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'reextractDocument', id, documentId }),
    })) as { stats?: { nodes?: unknown; links?: unknown }; warnings?: unknown };
    const nodes = body.stats?.nodes;
    const links = body.stats?.links;
    if (typeof nodes !== 'number' || typeof links !== 'number')
      throw new Error('重新抽取失败：响应缺少统计信息');
    return {
      stats: { nodes, links },
      warnings: Array.isArray(body.warnings) ? body.warnings.filter((item): item is string => typeof item === 'string') : [],
    };
  },

  /** DELETE 整个资料库。 */
  async deleteBundle(id: string): Promise<void> {
    await sendJson('/api/knowledge', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    });
  },

  /** PATCH 审核状态（无 action，走原 handlePatch）。 */
  async setReview(id: string, reviewStatus: string): Promise<void> {
    await sendJson('/api/knowledge', {
      method: 'PATCH',
      body: JSON.stringify({ id, reviewStatus }),
    });
  },

  /** PATCH upsertNode（nodeId 缺省为新增手动节点）。 */
  async upsertNode(id: string, draft: NodeDraft, nodeId?: string): Promise<void> {
    await sendJson('/api/knowledge', {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'upsertNode',
        id,
        node: draft,
        ...(nodeId ? { nodeId } : {}),
      }),
    });
  },

  /** PATCH deleteNode。 */
  async deleteNode(id: string, nodeId: string): Promise<void> {
    await sendJson('/api/knowledge', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'deleteNode', id, nodeId }),
    });
  },

  /** PATCH addLink。 */
  async addLink(id: string, source: string, target: string, relation: string): Promise<void> {
    await sendJson('/api/knowledge', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'addLink', id, source, target, relation }),
    });
  },

  /** PATCH updateLink。 */
  async updateLink(id: string, linkId: string, relation: string): Promise<void> {
    await sendJson('/api/knowledge', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'updateLink', id, linkId, relation }),
    });
  },

  /** PATCH deleteLink。 */
  async deleteLink(id: string, linkId: string): Promise<void> {
    await sendJson('/api/knowledge', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'deleteLink', id, linkId }),
    });
  },

  /** POST /api/knowledge/sync：全量同步到图谱后端。 */
  async sync(): Promise<SyncResult> {
    const response = await fetch('/api/knowledge/sync', { method: 'POST', cache: 'no-store' });
    const body = (await response.json().catch(() => null)) as
      | (SyncResult & { error?: unknown })
      | null;
    if (!response.ok) {
      const message = body && typeof body.error === 'string' ? body.error : '图谱同步失败';
      throw new Error(message);
    }
    return body ?? {};
  },

  /** GET neighbors：按 bundle+nodeId 懒加载 depth 跳 Ego 子图（Neo4j 优先，JSON 兜底）。 */
  async fetchNeighbors(bundle: string, nodeId: string, depth: 1 | 2): Promise<NeighborsResponse> {
    const response = await fetch(
      `/api/knowledge/neighbors?bundle=${encodeURIComponent(bundle)}&nodeId=${encodeURIComponent(nodeId)}&depth=${depth}`,
      { cache: 'no-store' },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || !Array.isArray(payload.nodes) || !Array.isArray(payload.links)) {
      throw new Error(payload?.error ?? `邻居查询失败（HTTP ${response.status}）`);
    }
    return payload as NeighborsResponse;
  },
};
