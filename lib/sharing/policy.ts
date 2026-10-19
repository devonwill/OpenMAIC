export type ResourceVisibility = 'private' | 'public';
export interface ResourcePolicy {
  ownerId?: string;
  visibility?: ResourceVisibility;
  sharedWithUserIds?: string[];
}

/** Public means authenticated platform members, not anonymous link holders. */
export function canReadResource(policy: ResourcePolicy, ownerId?: string): boolean {
  if (policy.ownerId && policy.ownerId === ownerId) return true;
  if (!ownerId?.startsWith('user:')) return false;
  return policy.visibility === 'public' || Boolean(policy.sharedWithUserIds?.includes(ownerId.slice(5)));
}
