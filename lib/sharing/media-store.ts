import type { Queryable } from '@openmaic/storage/document/pg';
import type { AssetStore } from '@openmaic/storage';
import { canReadResource, type ResourcePolicy } from './policy';

export const MEDIA_SHARING_SCHEMA = `
CREATE TABLE IF NOT EXISTS resource_permissions (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('asset', 'material')),
  resource_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  student_ids TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS resource_permissions_owner_idx ON resource_permissions(owner_id);
`;
export async function ensureMediaSharingSchema(db: Queryable): Promise<void> {
  for (const statement of MEDIA_SHARING_SCHEMA.split(';').map((sql) => sql.trim()).filter(Boolean)) await db.query(statement);
}
export type MediaKind = 'asset' | 'material';
export interface MediaPolicy extends ResourcePolicy { ownerId: string; visibility: 'private' | 'public'; sharedWithUserIds: string[] }

// Older assets have no explicit creator row: infer once from their original course.
// Explicit ownership recorded on allocation always wins over later reuse in another course.
export const ASSET_OWNER_SQL = `COALESCE(p.owner_id,
  (SELECT s.owner_id FROM document_asset_refs r JOIN stage_meta s ON s.stage_id = r.stage_id
    WHERE r.asset_id = a.id AND s.deleted_at IS NULL ORDER BY s.stage_id LIMIT 1))`;

export async function readMediaPolicy(db: Queryable, kind: MediaKind, id: string): Promise<MediaPolicy | null> {
  const result = await db.query<{ owner_id: string | null; visibility: 'private' | 'public' | null; student_ids: string[] | null }>(
    kind === 'asset'
      ? `SELECT ${ASSET_OWNER_SQL} AS owner_id, p.visibility, p.student_ids FROM asset_entries a
         LEFT JOIN resource_permissions p ON p.resource_type = 'asset' AND p.resource_id = a.id WHERE a.id = $1`
      : `SELECT m.owner_id, p.visibility, p.student_ids FROM owner_material m
         LEFT JOIN resource_permissions p ON p.resource_type = 'material' AND p.resource_id = m.id
         WHERE m.id = $1 AND m.status = 'ready' AND m.deleted_at IS NULL`, [id]);
  const row = result.rows[0];
  return row?.owner_id ? { ownerId: row.owner_id, visibility: row.visibility ?? 'private', sharedWithUserIds: row.student_ids ?? [] } : null;
}

export async function registerAssetOwner(db: Queryable, id: string, ownerId: string): Promise<void> {
  await db.query(`INSERT INTO resource_permissions(resource_type,resource_id,owner_id) VALUES ('asset',$1,$2) ON CONFLICT DO NOTHING`, [id, ownerId]);
}

export async function saveMediaPolicy(db: Queryable, kind: MediaKind, id: string, policy: MediaPolicy): Promise<void> {
  const result = await db.query(
    `INSERT INTO resource_permissions(resource_type,resource_id,owner_id,visibility,student_ids)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT(resource_type,resource_id) DO UPDATE
     SET visibility=EXCLUDED.visibility, student_ids=EXCLUDED.student_ids, updated_at=now()
     WHERE resource_permissions.owner_id=EXCLUDED.owner_id RETURNING resource_id`,
    [kind,id,policy.ownerId,policy.visibility,policy.sharedWithUserIds]);
  if (!result.rows.length) throw new Error('资源权限已变化，请刷新后重试');
}

export async function canReadMedia(db: Queryable, kind: MediaKind, id: string, ownerId: string): Promise<boolean> {
  const policy = await readMediaPolicy(db, kind, id);
  // Unclaimed legacy assets retain their old behavior; owned resources never use this fallback.
  return policy ? canReadResource(policy, ownerId) : kind === 'asset';
}

/** Record creator identity before an allocation id is returned to the browser. */
export function ownerBoundAssetStore(store: AssetStore, db: Queryable, ownerId: string): AssetStore {
  return new Proxy(store, {
    get(target, key) {
      if (key === 'put') return async (...args: Parameters<AssetStore['put']>) => {
        const id = await target.put(...args);
        await registerAssetOwner(db, id, ownerId);
        return id;
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
