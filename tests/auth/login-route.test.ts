import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionToken } from '@/lib/server/auth/session-token';

const mocks = vi.hoisted(() => ({
  getAuthDb: vi.fn(),
  getUserByEmail: vi.fn(),
  deleteSession: vi.fn(),
  verifyPassword: vi.fn(),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  clientIdentity: vi.fn(),
  isTrustedProxyIdentity: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock('@/lib/server/auth/db', () => ({ getAuthDb: mocks.getAuthDb }));
vi.mock('@/lib/server/auth/store', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getUserByEmail: mocks.getUserByEmail,
  deleteSession: mocks.deleteSession,
}));
vi.mock('@/lib/server/auth/password', () => ({ verifyPassword: mocks.verifyPassword }));
vi.mock('@/lib/server/auth/session-cookie', () => ({
  setSessionCookie: mocks.setSessionCookie,
  clearSessionCookie: mocks.clearSessionCookie,
  userView: (id: string, email: string, role: string, displayName: string, phone: string | null) => ({ id, email, role, displayName, phone }),
  SESSION_MAX_AGE_SECONDS: 2592000,
}));
vi.mock('@/lib/server/client-identity', () => ({
  clientIdentity: mocks.clientIdentity,
  isTrustedProxyIdentity: mocks.isTrustedProxyIdentity,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));

const DB = { query: vi.fn() };
const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 's@t.com',
  passwordHash: 'hash',
  role: 'student' as const,
  displayName: '小明',
  phone: '13800138000',
};
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

/** 每个用例重新加载路由，拿到独立的进程内限流器，避免用例间状态泄漏。 */
async function loadLogin(): Promise<(request: Request) => Promise<Response>> {
  vi.resetModules();
  const { POST } = await import('@/app/api/auth/login/route');
  return POST;
}

async function loadLogout(): Promise<() => Promise<Response>> {
  vi.resetModules();
  const { POST } = await import('@/app/api/auth/logout/route');
  return POST;
}

function loginRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://x/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 's@t.com', password: 'password8', ...overrides }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 限流器默认放行：非可信身份不计数，用例显式改写这两个 mock 才进入限流路径。
  mocks.clientIdentity.mockReturnValue('direct');
  mocks.isTrustedProxyIdentity.mockReturnValue(false);
  mocks.deleteSession.mockResolvedValue(undefined);
  mocks.clearSessionCookie.mockResolvedValue(undefined);
  process.env.SESSION_SECRET = 'test-secret';
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SESSION_SECRET;
});

describe('POST /api/auth/login', () => {
  it('returns 503 when DATABASE_URL is not configured', async () => {
    const POST = await loadLogin();
    mocks.getAuthDb.mockResolvedValue(null);
    const res = await POST(loginRequest());
    expect(res.status).toBe(503);
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it('returns 503 when SESSION_SECRET is not configured', async () => {
    const POST = await loadLogin();
    delete process.env.SESSION_SECRET;
    mocks.getAuthDb.mockResolvedValue(DB);
    const res = await POST(loginRequest());
    expect(res.status).toBe(503);
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it('rejects a malformed body or missing credentials (400)', async () => {
    const POST = await loadLogin();
    mocks.getAuthDb.mockResolvedValue(DB);
    const notJson = new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect((await POST(notJson)).status).toBe(400);
    expect((await POST(loginRequest({ password: undefined }))).status).toBe(400);
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it('logs in with correct credentials and sets the session cookie once', async () => {
    const POST = await loadLogin();
    mocks.getAuthDb.mockResolvedValue(DB);
    mocks.getUserByEmail.mockResolvedValue(USER);
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.setSessionCookie.mockResolvedValue(undefined);
    const res = await POST(loginRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.id).toBe(USER.id);
    expect(data.user.role).toBe('student');
    expect(mocks.setSessionCookie).toHaveBeenCalledOnce();
    expect(mocks.setSessionCookie).toHaveBeenCalledWith(USER.id, DB);
  });

  it('answers 401 with an identical body for a wrong password and an unknown email', async () => {
    const POST = await loadLogin();
    mocks.getAuthDb.mockResolvedValue(DB);

    mocks.getUserByEmail.mockResolvedValue(USER);
    mocks.verifyPassword.mockResolvedValue(false);
    const wrongPassword = await POST(loginRequest());
    const wrongPasswordBody = await wrongPassword.json();

    mocks.getUserByEmail.mockResolvedValue(null);
    const unknownEmail = await POST(loginRequest());
    const unknownEmailBody = await unknownEmail.json();

    // 不泄露邮箱存在性：两种失败的响应完全一致。
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmailBody).toEqual(wrongPasswordBody);
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it('never rate-limits an untrusted identity', async () => {
    const POST = await loadLogin();
    mocks.getAuthDb.mockResolvedValue(DB);
    mocks.getUserByEmail.mockResolvedValue(null);
    for (let i = 0; i < 30; i += 1) {
      expect((await POST(loginRequest())).status).toBe(401);
    }
  });

  it('locks out a trusted identity after 10 attempts (429 + Retry-After)', async () => {
    const POST = await loadLogin();
    mocks.getAuthDb.mockResolvedValue(DB);
    mocks.getUserByEmail.mockResolvedValue(null);
    mocks.clientIdentity.mockReturnValue('client-1');
    mocks.isTrustedProxyIdentity.mockReturnValue(true);

    for (let i = 0; i < 10; i += 1) {
      expect((await POST(loginRequest())).status).toBe(401);
    }
    const res = await POST(loginRequest());
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get('retry-after'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and clears the cookie (200)', async () => {
    const POST = await loadLogout();
    const token = createSessionToken(SESSION_ID, 'test-secret');
    mocks.cookieGet.mockReturnValue({ value: token });
    mocks.getAuthDb.mockResolvedValue(DB);

    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, loggedOut: true });
    expect(mocks.deleteSession).toHaveBeenCalledOnce();
    expect(mocks.deleteSession).toHaveBeenCalledWith(DB, SESSION_ID);
    expect(mocks.clearSessionCookie).toHaveBeenCalledOnce();
  });

  it('clears the cookie without touching the DB for an invalid token', async () => {
    const POST = await loadLogout();
    mocks.cookieGet.mockReturnValue({ value: 'garbage' });
    mocks.getAuthDb.mockResolvedValue(DB);

    const res = await POST();
    expect(res.status).toBe(200);
    expect(mocks.deleteSession).not.toHaveBeenCalled();
    expect(mocks.clearSessionCookie).toHaveBeenCalledOnce();
  });

  it('returns 200 without reading cookies when SESSION_SECRET is unset', async () => {
    const POST = await loadLogout();
    delete process.env.SESSION_SECRET;

    const res = await POST();
    expect(res.status).toBe(200);
    expect(mocks.deleteSession).not.toHaveBeenCalled();
    expect(mocks.clearSessionCookie).not.toHaveBeenCalled();
  });
});
