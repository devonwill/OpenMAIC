import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionToken } from '@/lib/server/auth/session-token';

// 与 Task 6（login-route.test.ts）同一 mock 模式：只 mock db / store / next/headers，
// session 验签走真实实现，保证「cookie → sessionId → 会话行」链路被真实覆盖。

const mocks = vi.hoisted(() => ({
  getAuthDb: vi.fn(),
  getSessionWithUser: vi.fn(),
  updateUserProfile: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock('@/lib/server/auth/db', () => ({ getAuthDb: mocks.getAuthDb }));
vi.mock('@/lib/server/auth/store', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionWithUser: mocks.getSessionWithUser,
  updateUserProfile: mocks.updateUserProfile,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));

import { GET, PATCH } from '@/app/api/auth/me/route';

const DB = { query: vi.fn() };
const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 's@t.com',
  passwordHash: 'hash',
  role: 'student' as const,
  displayName: '小明',
  phone: '13800138000',
  avatar: null,
};
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

function validToken(): string {
  return createSessionToken(SESSION_ID, 'test-secret') ?? '';
}

function patchRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://x/api/auth/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: '新名字', phone: '13900139000', ...overrides }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_SECRET = 'test-secret';
  mocks.getAuthDb.mockResolvedValue(DB);
  mocks.cookieGet.mockReturnValue({ value: validToken() });
  mocks.getSessionWithUser.mockResolvedValue({
    session: { id: SESSION_ID, userId: USER.id, expiresAt: new Date(), lastSeenAt: new Date() },
    user: USER,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SESSION_SECRET;
});

describe('GET /api/auth/me', () => {
  it('returns {user:null} with 200 when there is no session cookie', async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, user: null });
  });

  it('returns {user:null} with 200 for an invalid session token', async () => {
    mocks.cookieGet.mockReturnValue({ value: 'garbage' });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, user: null });
  });

  it('returns the user view (without passwordHash) for a signed-in user', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toEqual({
      id: USER.id,
      email: USER.email,
      role: 'student',
      displayName: '小明',
      phone: '13800138000',
      avatar: null,
    });
    expect(data.user.passwordHash).toBeUndefined();
  });

  it('reports storage failures as 503, not a signed-out user', async () => {
    mocks.getSessionWithUser.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).user).toBeUndefined();
  });

  it('returns {user:null} when the session row is gone', async () => {
    mocks.getSessionWithUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, user: null });
  });
});

describe('PATCH /api/auth/me', () => {
  it('rejects an anonymous caller with 401', async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    const res = await PATCH(patchRequest());
    expect(res.status).toBe(401);
    expect(mocks.updateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body with 400', async () => {
    const res = await PATCH(
      new Request('http://x/api/auth/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.updateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range displayName with 400', async () => {
    for (const displayName of ['', '   ', 'x'.repeat(33), 42]) {
      const res = await PATCH(patchRequest({ displayName }));
      expect(res.status).toBe(400);
    }
    expect(mocks.updateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects a malformed phone with 400', async () => {
    for (const phone of ['123', '23800138000', '138001380001', 13800138000]) {
      const res = await PATCH(patchRequest({ phone }));
      expect(res.status).toBe(400);
    }
    expect(mocks.updateUserProfile).not.toHaveBeenCalled();
  });

  it('updates the profile and echoes the new user view', async () => {
    mocks.updateUserProfile.mockResolvedValue(undefined);
    const res = await PATCH(patchRequest({ displayName: '  新名字  ' }));
    expect(res.status).toBe(200);
    expect(mocks.updateUserProfile).toHaveBeenCalledOnce();
    expect(mocks.updateUserProfile).toHaveBeenCalledWith(DB, USER.id, {
      displayName: '新名字',
      phone: '13900139000',
      avatar: null,
    });
    const data = await res.json();
    expect(data.user.displayName).toBe('新名字');
    expect(data.user.phone).toBe('13900139000');
    expect(data.user.email).toBe(USER.email);
  });

  it('normalizes an empty phone to null', async () => {
    mocks.updateUserProfile.mockResolvedValue(undefined);
    for (const phone of ['', null, undefined]) {
      const res = await PATCH(patchRequest({ phone }));
      expect(res.status).toBe(200);
    }
    expect(mocks.updateUserProfile).toHaveBeenCalledTimes(3);
    expect(mocks.updateUserProfile).toHaveBeenLastCalledWith(DB, USER.id, {
      displayName: '新名字',
      phone: null,
      avatar: null,
    });
  });

  it('persists a built-in avatar path', async () => {
    mocks.updateUserProfile.mockResolvedValue(undefined);
    const res = await PATCH(patchRequest({ avatar: '/avatars/user.png' }));
    expect(res.status).toBe(200);
    expect(mocks.updateUserProfile).toHaveBeenLastCalledWith(DB, USER.id, {
      displayName: '新名字',
      phone: '13900139000',
      avatar: '/avatars/user.png',
    });
    const data = await res.json();
    expect(data.user.avatar).toBe('/avatars/user.png');
  });

  it('rejects an avatar that is not a built-in path, http(s) URL, or data URL', async () => {
    const res = await PATCH(patchRequest({ avatar: '/etc/passwd' }));
    expect(res.status).toBe(400);
    expect(mocks.updateUserProfile).not.toHaveBeenCalled();
  });

  it('returns 503 when the database is unavailable', async () => {
    // currentUser 在无库时解析不到会话 → 401；单独验证 PATCH 的无库分支需要先登录成功。
    // 这里直接让第一次调用（currentUser）拿到库、第二次（PATCH 本体）拿不到。
    mocks.getAuthDb.mockResolvedValueOnce(DB).mockResolvedValueOnce(null);
    const res = await PATCH(patchRequest());
    expect(res.status).toBe(503);
    expect(mocks.updateUserProfile).not.toHaveBeenCalled();
  });
});
