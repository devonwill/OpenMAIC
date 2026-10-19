import { canReadResource } from '@/lib/sharing/policy';
import type { KnowledgeBundle } from './schema';
import { resolveAuthenticatedOwnerId } from '@/lib/server/auth/identity';
import { resolveRequestOwnerId } from '@/lib/server/agent-runtime/owner';

/** Unowned legacy bundles are shared; owned bundles are private. */
export function canReadKnowledge(bundle: KnowledgeBundle, ownerId?: string): boolean {
  return !bundle.ownerId || canReadResource(bundle, ownerId);
}

export async function knowledgeRequestOwner(
  request: Pick<Request, 'headers'>,
  headers = new Headers(),
): Promise<string> {
  return resolveRequestOwnerId(request, headers, await resolveAuthenticatedOwnerId(request));
}
