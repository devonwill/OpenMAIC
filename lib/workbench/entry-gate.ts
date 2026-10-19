import { isAgentRuntimeConfigured, isProWorkbenchEnabled } from '@/lib/config/feature-flags';
import { resolveRequestOwnerId } from '@/lib/server/agent-runtime/owner';
import { resolveAuthenticatedOwnerId } from '@/lib/server/auth/identity';
import { getAuthDb } from '@/lib/server/auth/db';

/** Server-authoritative decision shared by every workbench entry route. */
export function isWorkbenchEntryEnabled(): boolean {
  return isProWorkbenchEnabled() && isAgentRuntimeConfigured();
}

/**
 * Workbench is teacher-only. Anonymous (no cookie) and student users are
 * redirected away. Teachers always pass; this is a coarse role gate, not a
 * model-config gate (the model-config nudge lives in the home page hero).
 */
export async function isWorkbenchEntryAllowedForRequest(
  request: Request,
): Promise<boolean> {
  if (!isWorkbenchEntryEnabled()) return false;
  const ownerId = await resolveRequestOwnerId(
    request,
    new Headers(),
    await resolveAuthenticatedOwnerId(request),
  );
  if (!ownerId.startsWith('user:')) return false;
  const userId = ownerId.slice(5);
  try {
    const db = await getAuthDb();
    if (!db) return false;
    const result = await db.query<{ role: 'teacher' | 'student' }>(
      'SELECT role FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0]?.role === 'teacher';
  } catch {
    // DB outage on a role gate should not silently grant access; fail closed.
    return false;
  }
}
