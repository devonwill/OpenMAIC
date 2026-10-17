import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionToken } from '@/lib/server/auth/session-token';
import { decryptSecret, encryptSecret } from '@/lib/server/auth/secret-box';

// 教师模型配置路由：真实 encryptSecret/decryptSecret + 固定测试 KEY，
// 只 mock store 层，确保「明文 → 密文落库 → 解密回明文」闭环被真实加密逻辑覆盖。

const mocks = vi.hoisted(() => ({
  getAuthDb: vi.fn(),
  getSessionWithUser: vi.fn(),
  getTeacherModelConfig: vi.fn(),
  saveTeacherModelConfig: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock('@/lib/server/auth/db', () => ({ getAuthDb: mocks.getAuthDb }));
vi.mock('@/lib/server/auth/store', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionWithUser: mocks.getSessionWithUser,
  getTeacherModelConfig: mocks.getTeacherModelConfig,
  saveTeacherModelConfig: mocks.saveTeacherModelConfig,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));

import { GET, PUT } from '@/app/api/auth/me/model-config/route';

// 固定 32 字节测试 KEY：确定性，避免 randomBytes 让用例不可复现。
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

const DB = { query: vi.fn() };
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 't@t.com',
  passwordHash: 'hash',
  role: 'teacher' as const,
  displayName: '张老师',
  phone: null,
};
const STUDENT = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 's@t.com',
  passwordHash: 'hash',
  role: 'student' as const,
  displayName: '小明',
  phone: null,
};
const PROVIDERS_CONFIG = {
  openai: { models: ['gpt-4o'], apiKey: 'sk-secret' },
  deepseek: { models: ['deepseek-chat'] },
};

function validToken(): string {
  return createSessionToken(SESSION_ID, 'test-secret') ?? '';
}

function signIn(user: typeof TEACHER | typeof STUDENT): void {
  mocks.cookieGet.mockReturnValue({ value: validToken() });
  mocks.getSessionWithUser.mockResolvedValue({
    session: { id: SESSION_ID, userId: user.id, expiresAt: new Date(), lastSeenAt: new Date() },
    user,
  });
}

function putRequest(providersConfig: unknown): Request {
  return new Request('http://x/api/auth/me/model-config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providersConfig }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_SECRET = 'test-secret';
  process.env.ENCRYPTION_KEY = TEST_KEY;
  mocks.getAuthDb.mockResolvedValue(DB);
  signIn(TEACHER);
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SESSION_SECRET;
  delete process.env.ENCRYPTION_KEY;
});

describe('GET /api/auth/me/model-config', () => {
  it('rejects an anonymous caller with 401', async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mocks.getTeacherModelConfig).not.toHaveBeenCalled();
  });

  it('rejects a student with 403 (teacher-only)', async () => {
    signIn(STUDENT);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mocks.getTeacherModelConfig).not.toHaveBeenCalled();
  });

  it('returns {providersConfig:null} when the teacher has no stored config', async () => {
    mocks.getTeacherModelConfig.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, providersConfig: null });
  });

  it('decrypts the stored ciphertext back to the original object', async () => {
    mocks.getTeacherModelConfig.mockResolvedValue(
      encryptSecret(JSON.stringify(PROVIDERS_CONFIG), TEST_KEY),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.providersConfig).toEqual(PROVIDERS_CONFIG);
  });

  it('returns 500 when the stored ciphertext cannot be decrypted', async () => {
    mocks.getTeacherModelConfig.mockResolvedValue('v1.a.b.c');
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('returns 503 when ENCRYPTION_KEY is not configured', async () => {
    delete process.env.ENCRYPTION_KEY;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(mocks.getTeacherModelConfig).not.toHaveBeenCalled();
  });
});

describe('PUT /api/auth/me/model-config', () => {
  it('rejects an anonymous caller with 401', async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    const res = await PUT(putRequest(PROVIDERS_CONFIG));
    expect(res.status).toBe(401);
    expect(mocks.saveTeacherModelConfig).not.toHaveBeenCalled();
  });

  it('rejects a student with 403 (teacher-only)', async () => {
    signIn(STUDENT);
    const res = await PUT(putRequest(PROVIDERS_CONFIG));
    expect(res.status).toBe(403);
    expect(mocks.saveTeacherModelConfig).not.toHaveBeenCalled();
  });

  it('rejects a non-object providersConfig with 400', async () => {
    for (const bad of ['str', 42, null, [1, 2], true]) {
      const res = await PUT(putRequest(bad));
      expect(res.status).toBe(400);
    }
    expect(mocks.saveTeacherModelConfig).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body with 400', async () => {
    const res = await PUT(new Request('http://x/api/auth/me/model-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    }));
    expect(res.status).toBe(400);
  });

  it('rejects an oversized providersConfig with 413', async () => {
    const res = await PUT(putRequest({ blob: 'x'.repeat(1_000_001) }));
    expect(res.status).toBe(413);
    expect(mocks.saveTeacherModelConfig).not.toHaveBeenCalled();
  });

  it('saves a ciphertext that decrypts back to the original object', async () => {
    mocks.saveTeacherModelConfig.mockResolvedValue(undefined);
    const res = await PUT(putRequest(PROVIDERS_CONFIG));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, saved: true });
    expect(mocks.saveTeacherModelConfig).toHaveBeenCalledOnce();
    const [db, userId, ciphertext] = mocks.saveTeacherModelConfig.mock.calls[0] as [unknown, string, string];
    expect(db).toBe(DB);
    expect(userId).toBe(TEACHER.id);
    // 密文不落明文，且解密后与原对象一致（last-write-wins UPSERT 由 store 层保证）。
    expect(ciphertext).not.toContain('sk-secret');
    expect(JSON.parse(decryptSecret(ciphertext, TEST_KEY))).toEqual(PROVIDERS_CONFIG);
  });

  it('returns 503 when ENCRYPTION_KEY is not configured', async () => {
    delete process.env.ENCRYPTION_KEY;
    const res = await PUT(putRequest(PROVIDERS_CONFIG));
    expect(res.status).toBe(503);
    expect(mocks.saveTeacherModelConfig).not.toHaveBeenCalled();
  });
});
