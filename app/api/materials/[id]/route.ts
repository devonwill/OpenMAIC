/**
 * GET /api/materials/[id]?sessionId= — one owned session's material, in the
 * same public projection the list and the agent's `list_materials` tool use.
 *
 * Materials are session-scoped; the client names the session and the session's
 * owner row is the authorization. A foreign or missing session, and a material
 * id that does not exist or belongs to another session, all answer the same
 * plain 404 (no existence oracle).
 *
 * The session-scoped GET stays read-only (the session-material store has no
 * delete operation). Owner-scoped writes are exposed by this file's PATCH
 * (rename) and DELETE (soft delete + best-effort byte cleanup): they
 * authorize against the owner-material library, not a session, and answer the
 * same plain 404 for foreign/missing rows.
 */
import type { NextRequest } from 'next/server';

import type { ConnectableQueryable } from '@openmaic/storage/server/reference';

import { isAgentRuntimeConfigured } from '@/lib/config/feature-flags';
import { apiError } from '@/lib/server/api-response';
import {
  getSessionMaterial,
  publicMaterialView,
  resolveOwnedSession,
} from '@/lib/server/agent-runtime/session-materials';
import {
  ownerApiError,
  ownerJson,
  ownerNotFound,
} from '@/lib/server/agent-runtime/route-response';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import {
  deleteOwnerMaterial,
  publicMaterial,
  renameOwnerMaterial,
} from '@/lib/persistence/owner-materials';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { getMaterialByteStore } from '@/lib/server/materials/bytes';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isAgentRuntimeConfigured()) return new Response('Not found', { status: 404 });

  const sessionId = new URL(req.url).searchParams.get('sessionId')?.trim();
  if (!sessionId) return apiError('MISSING_REQUIRED_FIELD', 400, 'sessionId is required');

  return withRequestOwnerId(req, async (ownerId, responseHeaders) => {
    const session = await resolveOwnedSession(sessionId, ownerId);
    if (!session) return ownerNotFound(responseHeaders);
    const { id } = await params;
    const material = await getSessionMaterial(sessionId, id);
    if (!material) return ownerNotFound(responseHeaders);
    return ownerJson({ material: publicMaterialView(material) }, 200, responseHeaders);
  });
}

// PATCH /api/materials/[id] — owner 级重命名：仅更新展示名（original_name），
// 字节与摘要不动。软数据更新不改状态机，任何未删行都可改。
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!isAgentRuntimeConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwnerId(req, async (ownerId, responseHeaders) => {
    if (!ownerId) return ownerNotFound(responseHeaders);
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { originalName?: unknown } | null;
    const name = typeof body?.originalName === 'string' ? body.originalName.trim() : '';
    // trim 后须非空且 ≤512，与上传侧文件名上限一致；400 也要带 owner 头（Set-Cookie）。
    if (!name || name.length > 512) {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        'originalName 需为 1-512 字符',
        responseHeaders,
      );
    }
    const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const row = await renameOwnerMaterial(
      provider.pool as unknown as ConnectableQueryable,
      ownerId,
      id,
      name,
    );
    if (!row) return ownerNotFound(responseHeaders);
    return ownerJson({ material: publicMaterial(row) }, 200, responseHeaders);
  });
}

// DELETE /api/materials/[id] — owner 级软删（置 deleted_at），行返回携带
// oss_key 供字节清理；与 GET 的 404 语义一致，无存在性 oracle。
export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isAgentRuntimeConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwnerId(req, async (ownerId, responseHeaders) => {
    if (!ownerId) return ownerNotFound(responseHeaders);
    const { id } = await params;
    const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const row = await deleteOwnerMaterial(
      provider.pool as unknown as ConnectableQueryable,
      ownerId,
      id,
    );
    if (!row) return ownerNotFound(responseHeaders);
    // 字节清理尽力而为：软删已落库，清理失败不回滚、仍答 200，仅告警留痕。
    try {
      await getMaterialByteStore().delete(row.ossKey);
    } catch (error) {
      console.warn(
        'owner material byte cleanup failed; row stays soft-deleted',
        { materialId: id, ossKey: row.ossKey },
        error,
      );
    }
    return ownerJson({ deleted: true }, 200, responseHeaders);
  });
}
