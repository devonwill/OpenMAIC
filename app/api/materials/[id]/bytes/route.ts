import { canReadMedia, readMediaPolicy } from '@/lib/sharing/media-store';
/**
 * GET /api/materials/[id]/bytes — owner 库素材的原始字节读取。
 *
 * 所有权经 getReadyOwnerMaterials 判定（owner_id + 未删 + ready），未命中与
 * 字节缺失（ENOENT）统一答同一个 plain 404：外部无法区分「不存在」「别人的」
 * 和「字节丢了」，无存在性 oracle（与本目录 [id]/route.ts 的语义一致）。
 *
 * Set-Cookie 必须 rides 字节响应：headers 从 withRequestOwnerId 给出的
 * responseHeaders 拷贝（否则重试的客户端会换一个匿名 owner 分区）。
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import type { ConnectableQueryable } from '@openmaic/storage/server/reference';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getReadyOwnerMaterials } from '@/lib/persistence/owner-materials';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import { getMaterialByteStore } from '@/lib/server/materials/bytes';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwnerId(req, async (ownerId, responseHeaders) => {
    if (!ownerId) return ownerNotFound(responseHeaders);
    const { id } = await params;
    const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const policy = await readMediaPolicy(provider.pool, 'material', id);
    if (!policy || !await canReadMedia(provider.pool, 'material', id, ownerId)) return ownerNotFound(responseHeaders);
    const [record] = await getReadyOwnerMaterials(
      provider.pool as unknown as ConnectableQueryable,
      policy.ownerId,
      [id],
    );
    if (!record) return ownerNotFound(responseHeaders);

    let bytes: Buffer;
    try {
      bytes = await getMaterialByteStore().get(record.ossKey);
    } catch (error) {
      // 字节缺失与无权访问统一 404；其余错误向上抛，由 withRequestOwnerId
      // 转 500 —— 存储故障不能伪装成「不存在」，也不静默吞。
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return ownerNotFound(responseHeaders);
      }
      throw error;
    }

    // 拷贝既有 responseHeaders（保住 Set-Cookie），再覆盖内容头。
    const headers = new Headers(responseHeaders);
    if (record.mime) headers.set('content-type', record.mime);
    // 私有素材不进共享缓存；短 max-age 允许客户端免重复回源。
    headers.set('cache-control', 'private, no-store');
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers });
  });
}
