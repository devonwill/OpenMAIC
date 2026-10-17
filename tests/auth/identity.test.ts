import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthDb: vi.fn(),
  verifySessionToken: vi.fn(),
}));

vi.mock('@/lib/server/auth/db', () => ({ getAuthDb: mocks.getAuthDb }));
vi.mock('@/lib/server/auth/session-token', () => ({
  verifySessionToken: mocks.verifySessionToken,
}));

import { resolveAuthenticatedOwnerId } from '@/lib/server/auth/identity';

function reqWithCookie(cookie?: string): Request {
  return new Request('http://x/api/stages', {
    headers: cookie ? { cookie } : {},
  });
}

afterEach(() => vi.clearAllMocks());

describe('resolveAuthenticatedOwnerId', () => {
  it('returns undefined without a session cookie', async () => {
    expect(await resolveAuthenticatedOwnerId(reqWithCookie())).toBeUndefined();
    expect(mocks.getAuthDb).not.toHaveBeenCalled();
  });

  it('returns undefined without SESSION_SECRET', async () => {
    delete process.env.SESSION_SECRET;
    expect(await resolveAuthenticatedOwnerId(reqWithCookie('openmaic_session=abc.def'))).toBeUndefined();
  });

  it('maps a valid session to user:{id}', async () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    mocks.verifySessionToken.mockReturnValue('sid-1');
    mocks.getAuthDb.mockResolvedValue({
      query: async () => ({
        rows: [{
          id: 'u-1', email: 'a@b.c', password_hash: 'x', role: 'teacher',
          display_name: 'A', phone: null,
          session_id: 'sid-1', expires_at: new Date(), last_seen_at: new Date(),
        }],
      }),
    });
    expect(await resolveAuthenticatedOwnerId(reqWithCookie('openmaic_session=token.sig'))).toBe('user:u-1');
    delete process.env.SESSION_SECRET;
  });

  it('falls back to undefined on any failure (bad signature, dead session, db error)', async () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    mocks.verifySessionToken.mockReturnValue(null);
    expect(await resolveAuthenticatedOwnerId(reqWithCookie('openmaic_session=bad'))).toBeUndefined();
    mocks.verifySessionToken.mockReturnValue('sid-2');
    mocks.getAuthDb.mockRejectedValue(new Error('db down'));
    expect(await resolveAuthenticatedOwnerId(reqWithCookie('openmaic_session=ok.sig'))).toBeUndefined();
    delete process.env.SESSION_SECRET;
  });
});
