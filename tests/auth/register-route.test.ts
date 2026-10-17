import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthDb: vi.fn(),
  createUser: vi.fn(),
  createSession: vi.fn(),
  hashPassword: vi.fn(),
  setSessionCookie: vi.fn(),
}));

vi.mock('@/lib/server/auth/db', () => ({ getAuthDb: mocks.getAuthDb }));
vi.mock('@/lib/server/auth/store', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createUser: mocks.createUser,
  EmailTakenError: class extends Error {},
}));
vi.mock('@/lib/server/auth/password', () => ({ hashPassword: mocks.hashPassword }));
vi.mock('@/lib/server/auth/session-cookie', () => ({
  setSessionCookie: mocks.setSessionCookie,
  userView: (id: string, email: string, role: string, displayName: string) => ({ id, email, role, displayName }),
  SESSION_MAX_AGE_SECONDS: 2592000,
}));

import { POST as register } from '@/app/api/auth/register/route';

const DB = { query: vi.fn() };

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.TEACHER_INVITE_CODE;
  delete process.env.SESSION_SECRET;
});

const body = (overrides: Record<string, unknown> = {}) => ({
  role: 'student', email: 's@t.com', password: 'password8',
  displayName: '小明', ...overrides,
});

describe('POST /api/auth/register', () => {
  it('rejects when DATABASE_URL is unset (503)', async () => {
    mocks.getAuthDb.mockResolvedValue(null);
    const res = await register(new Request('http://x', { method: 'POST', body: JSON.stringify(body()), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(503);
  });

  it('registers a student without an invite code and auto-logs-in', async () => {
    mocks.getAuthDb.mockResolvedValue(DB);
    mocks.hashPassword.mockResolvedValue('hash');
    mocks.createUser.mockResolvedValue(undefined);
    mocks.setSessionCookie.mockResolvedValue(undefined);
    const res = await register(new Request('http://x', { method: 'POST', body: JSON.stringify(body()), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.user.role).toBe('student');
    expect(mocks.setSessionCookie).toHaveBeenCalledOnce();
  });

  it('rejects a teacher without a matching invite code (403)', async () => {
    process.env.TEACHER_INVITE_CODE = 'SECRET123';
    mocks.getAuthDb.mockResolvedValue(DB);
    const res = await register(new Request('http://x', { method: 'POST', body: JSON.stringify(body({ role: 'teacher', inviteCode: 'WRONG' })), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(403);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it('registers a teacher with the right invite code', async () => {
    process.env.TEACHER_INVITE_CODE = 'SECRET123';
    mocks.getAuthDb.mockResolvedValue(DB);
    mocks.hashPassword.mockResolvedValue('hash');
    mocks.createUser.mockResolvedValue(undefined);
    mocks.setSessionCookie.mockResolvedValue(undefined);
    const res = await register(new Request('http://x', { method: 'POST', body: JSON.stringify(body({ role: 'teacher', inviteCode: 'SECRET123' })), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(201);
  });

  it('rejects bad payloads (400): short password / bad phone / bad role', async () => {
    mocks.getAuthDb.mockResolvedValue(DB);
    for (const bad of [body({ password: 'short' }), body({ phone: '123' }), body({ role: 'admin' })]) {
      const res = await register(new Request('http://x', { method: 'POST', body: JSON.stringify(bad), headers: { 'content-type': 'application/json' } }));
      expect(res.status).toBe(400);
    }
  });

  it('conflicts on a taken email (409)', async () => {
    mocks.getAuthDb.mockResolvedValue(DB);
    mocks.hashPassword.mockResolvedValue('hash');
    const { EmailTakenError } = await import('@/lib/server/auth/store');
    mocks.createUser.mockRejectedValue(new EmailTakenError());
    const res = await register(new Request('http://x', { method: 'POST', body: JSON.stringify(body()), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(409);
  });
});
