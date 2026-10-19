import { describe, expect, it, vi } from 'vitest';
import { createAuthClient } from '@/lib/auth-client';

const user = {
  id: 'one',
  email: 'one@example.com',
  role: 'student',
  displayName: 'One',
  phone: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('auth request ordering', () => {
  it('does not resurrect a user when /me finishes after logout', async () => {
    const pending = deferred<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(Response.json({ success: true }));
    const client = createAuthClient(fetcher);
    const refreshing = client.refresh();
    await client.logout();
    pending.resolve(Response.json({ user }));
    await refreshing;
    expect(client.getSnapshot().user).toBeNull();
  });
  it('ignores an older refresh completing after a newer refresh', async () => {
    const pending = deferred<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(Response.json({ user }));
    const client = createAuthClient(fetcher);
    const old = client.refresh();
    await client.refresh();
    pending.resolve(Response.json({ user: null }));
    await old;
    expect(client.getSnapshot().user).toEqual(user);
  });
  it('preserves identity on server failure, but clears it for a real unauthenticated response', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ user }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const client = createAuthClient(fetcher);
    await client.refresh();
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ user, loading: false });
    expect(client.getSnapshot().error).toBeTruthy();
    await client.refresh();
    expect(client.getSnapshot().user).toBeNull();
  });
  it('reports a failed logout without pretending the server session is gone', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ user }))
      .mockRejectedValueOnce(new Error('offline'));
    const client = createAuthClient(fetcher);
    await client.refresh();
    await expect(client.logout()).rejects.toThrow();
    expect(client.getSnapshot().user).toEqual(user);
  });
  it('coalesces logout and prevents refresh during logout from restoring the user', async () => {
    const pending = deferred<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ user }))
      .mockReturnValueOnce(pending.promise);
    const client = createAuthClient(fetcher);
    await client.refresh();
    const logout = client.logout();
    expect(client.logout()).toBe(logout);
    const refresh = client.refresh();
    pending.resolve(Response.json({ success: true }));
    await logout;
    await refresh;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot().user).toBeNull();
  });
});
