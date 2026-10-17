import { resolveRequestOwnerId } from './owner';
import { resolveAuthenticatedOwnerId } from '@/lib/server/auth/identity';

/**
 * Resolve the request owner identity and run a handler with its response
 * headers.
 *
 * The Set-Cookie minted by resolveRequestOwnerId must ride every response,
 * including 4xx and 5xx: a client that retries after an error keeps the same
 * owner partition, while a 500 that dropped the cookie would silently make
 * the retry a different anonymous owner.
 *
 * Logged-in users take precedence over the anonymous cookie: their data
 * lives in the `user:{id}` partition (owner.ts's authenticatedOwnerId).
 */
export async function withRequestOwnerId(
  req: Pick<Request, 'headers'>,
  handler: (ownerId: string, responseHeaders: Headers) => Promise<Response>,
): Promise<Response> {
  const responseHeaders = new Headers();
  const authenticatedOwnerId = await resolveAuthenticatedOwnerId(req);
  const ownerId = resolveRequestOwnerId(req, responseHeaders, authenticatedOwnerId);
  try {
    return await handler(ownerId, responseHeaders);
  } catch (error) {
    console.error('[agent-runtime] request failed under an anonymous owner', error);
    return new Response('Internal Server Error', { status: 500, headers: responseHeaders });
  }
}
