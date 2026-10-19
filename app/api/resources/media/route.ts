import { NextRequest, NextResponse } from 'next/server';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { ASSET_OWNER_SQL } from '@/lib/sharing/media-store';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ materials: [] }, { headers: { 'Cache-Control': 'no-store' } });
  return withRequestOwnerId(request, async (ownerId, headers) => {
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL!);
    const result = await pool.query<{
      id: string; resource_type: 'asset' | 'material'; owner_id: string; mime: string; bytes: string;
      name: string | null; created_at: number; visibility: 'private' | 'public'; student_ids: string[];
    }>(`WITH media AS (
      SELECT a.id, 'asset' AS resource_type, ${ASSET_OWNER_SQL} AS owner_id, a.mime, b.byte_size AS bytes,
        COALESCE(a.meta->>'name', a.meta->>'filename', a.meta->>'originalName', '生成媒体') AS name,
        a.created_at, COALESCE(p.visibility,'private') AS visibility, COALESCE(p.student_ids,'{}') AS student_ids
      FROM asset_entries a JOIN asset_blobs b ON b.content_hash=a.content_hash
      LEFT JOIN resource_permissions p ON p.resource_type='asset' AND p.resource_id=a.id
      WHERE a.mime LIKE 'image/%' OR a.mime LIKE 'video/%' OR a.mime LIKE 'audio/%'
      UNION ALL
      SELECT m.id, 'material', m.owner_id, m.mime, m.bytes::bigint, m.original_name, m.created_at,
        COALESCE(p.visibility,'private'), COALESCE(p.student_ids,'{}')
      FROM owner_material m LEFT JOIN resource_permissions p ON p.resource_type='material' AND p.resource_id=m.id
      WHERE m.status='ready' AND m.deleted_at IS NULL
    ) SELECT * FROM media WHERE owner_id=$1 OR ($2::boolean AND (visibility='public' OR $3=ANY(student_ids)))
    ORDER BY created_at DESC, id LIMIT 500`, [ownerId, ownerId.startsWith('user:'), ownerId.startsWith('user:') ? ownerId.slice(5) : '']);
    headers.set('Cache-Control', 'no-store');
    return NextResponse.json({ materials: result.rows.map((row) => ({
      materialId: row.id, resourceType: row.resource_type, kind: 'source', mime: row.mime, bytes: Number(row.bytes),
      originalName: row.name, createdAt: new Date(Number(row.created_at)).toISOString(),
      canEdit: row.owner_id === ownerId, visibility: row.visibility,
      sharedWithMe: row.owner_id !== ownerId && row.student_ids.includes(ownerId.slice(5)),
      bytesUrl: row.resource_type === 'asset' ? `/api/persistence/assets/${encodeURIComponent(row.id)}/content` : `/api/materials/${encodeURIComponent(row.id)}/bytes`,
    })) }, { headers });
  });
}
