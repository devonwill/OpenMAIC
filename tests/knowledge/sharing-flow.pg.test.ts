/**
 * End-to-end sharing flow (PG contract).
 *
 * Exercises the production `/api/resources/sharing` GET/PATCH routes and
 * `/api/knowledge` GET under a real PostgreSQL with the real auth + knowledge
 * stores. Verifies:
 *
 *  1. Teacher registers (via the real /api/auth/register handler).
 *  2. Student registers.
 *  3. Teacher creates a private library (real POST /api/knowledge).
 *  4. Student cannot see the library in their catalog.
 *  5. Teacher sets visibility=public via the real PATCH /api/resources/sharing.
 *  6. Student now sees it as 'public' / 'sharedWithMe=false'.
 *  7. Teacher revokes → student cannot see it again.
 *  8. Teacher shares privately to a single student email → student sees it as
 *     'sharedWithMe=true'; a second student does not.
 *  9. Student who was shared-to cannot mutate the library (PATCH /api/knowledge
 *     updateLibrary → 403).
 *
 * Skips when PG_CONTRACT_URL is not set (no local PG to bind to).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Each test gets its own fake cookie store keyed by request so multiple
// concurrent NextRequest instances don't trample each other's cookies.
const activeCookies: Record<string, string> = {};
vi.mock('next/headers', () => ({
  // The production `cookies()` is async; the mock returns a thenable object
  // that also exposes the synchronous `get` API used by the auth code.
  cookies: () => ({
    get: (name: string) => {
      const value = activeCookies[name];
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      activeCookies[name] = value;
    },
    delete: (name: string) => {
      delete activeCookies[name];
    },
  }),
}));

const contractUrl = process.env.PG_CONTRACT_URL;

function dbUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

function req(url: string, init: { method?: string; cookie?: string; body?: unknown } = {}): NextRequest {
  // Load the caller's cookie string into the mock cookie store before the
  // handler runs, so `cookies().get(SESSION_COOKIE)` returns the right value.
  if (init.cookie) {
    for (const part of init.cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) activeCookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/**
 * Apply any Set-Cookie headers from `res` into the shared mock cookie store
 * so subsequent calls re-use the freshly-issued session token.
 */
function captureCookies(res: Response) {
  // The Response may expose set-cookie via getSetCookie (Node 20+) or the
  // legacy single-cookie accessor. Try both.
  const getSet = (res as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const all = typeof getSet === 'function' ? getSet.call(res) : null;
  const cookies = all ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
  for (const raw of cookies) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) activeCookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}

describe.skipIf(!contractUrl)('sharing flow (real PG)', () => {
  const url = contractUrl!;
  const CONTRACT_DB = `openmaic_share_${process.pid}_${Date.now()}`;
  const SESSION_SECRET = 'a'.repeat(64);
  let pool: Pool;
  let dataDir: string;
  // dynamic imports so we can stub env before the modules read it
  let registerPost: typeof import('@/app/api/auth/register/route').POST;
  let knowledgeGet: typeof import('@/app/api/knowledge/route').GET;
  let knowledgePost: typeof import('@/app/api/knowledge/route').POST;
  let sharingGet: typeof import('@/app/api/resources/sharing/route').GET;
  let sharingPatch: typeof import('@/app/api/resources/sharing/route').PATCH;

  const teacher = { email: 't@test.local', password: 'T-pass-123', displayName: 'TeacherT' };
  const studentA = { email: 'a@test.local', password: 'A-pass-123', displayName: 'StudentA' };
  const studentB = { email: 'b@test.local', password: 'B-pass-123', displayName: 'StudentB' };

  async function register(account: typeof teacher, role: 'teacher' | 'student'): Promise<string> {
    const body: Record<string, unknown> = {
      role,
      email: account.email,
      password: account.password,
      displayName: account.displayName,
    };
    if (role === 'teacher') body.inviteCode = 'TEST-TEACHER-CODE';
    const res = await registerPost(
      req('http://localhost/api/auth/register', { method: 'POST', body }),
    );
    expect(res.status, `register ${account.email}`).toBe(201);
    captureCookies(res);
    const session = activeCookies['openmaic_session'];
    expect(session, `register set-cookie for ${account.email}`).toBeTruthy();
    return `openmaic_session=${session}`;
  }

  beforeAll(async () => {
    // 1. Create a fresh database for this test so we don't collide with any
    //    other concurrently-running PG contract suite.
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: dbUrl(url, CONTRACT_DB), max: 4 });

    // 2. Knowledge storage uses a local JSON directory; isolate it per test.
    dataDir = await mkdtemp(path.join(tmpdir(), 'sharing-flow-'));
    vi.stubEnv('KNOWLEDGE_DATA_DIR', dataDir);
    vi.stubEnv('CODE_DATA_DIR', path.join(dataDir, 'code'));

    // 3. Point the whole stack at the test database, with a stable SESSION_SECRET
    //    so the HMAC verifier can sign/verify session cookies consistently.
    process.env.DATABASE_URL = dbUrl(url, CONTRACT_DB);
    process.env.SESSION_SECRET = SESSION_SECRET;
    process.env.NEO4J_URI = '';
    process.env.KNOWLEDGE_CLASSROOM_ENABLED = 'true';
    process.env.PERSISTENCE_ALLOW_INSECURE_DEV_AUTH = 'false';
    process.env.TEACHER_INVITE_CODE = 'TEST-TEACHER-CODE';
    // The auth schema is created lazily; force it now so subsequent calls
    // don't race. ensureAuthSchema is idempotent.
    const { ensureAuthSchema } = await import('@/lib/server/auth/store');
    const { ensureMediaSharingSchema } = await import('@/lib/sharing/media-store');
    await ensureAuthSchema(pool);
    await ensureMediaSharingSchema(pool);

    registerPost = (await import('@/app/api/auth/register/route')).POST;
    knowledgeGet = (await import('@/app/api/knowledge/route')).GET;
    knowledgePost = (await import('@/app/api/knowledge/route')).POST;
    sharingGet = (await import('@/app/api/resources/sharing/route')).GET;
    sharingPatch = (await import('@/app/api/resources/sharing/route')).PATCH;
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(dataDir, { recursive: true, force: true });
    await pool.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [CONTRACT_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();
  });

  it('runs the full publish/share/revoke cycle end-to-end', async () => {
    // 1. Register teacher + 2 students.
    const teacherCookie = await register(teacher, 'teacher');
    const studentACookie = await register(studentA, 'student');
    const studentBCookie = await register(studentB, 'student');

    // 2. Teacher creates a private library.
    const libRes = await knowledgePost(
      req('http://localhost/api/knowledge', {
        method: 'POST',
        cookie: teacherCookie,
        body: { action: 'createLibrary', title: 'E2E lib', description: 'sharing test' },
      }),
    );
    expect(libRes.status).toBe(201);
    const libId = (await libRes.json()).id as string;
    expect(libId).toMatch(/^lib-/);

    const teacherCatalog = await (await knowledgeGet(req('http://localhost/api/knowledge', { cookie: teacherCookie }))).json();
    expect(teacherCatalog.catalog.map((b: { id: string }) => b.id)).toContain(libId);

    // 3. Student A's catalog should not contain the new library.
    const aCatalog0 = await (await knowledgeGet(req('http://localhost/api/knowledge', { cookie: studentACookie }))).json();
    expect(aCatalog0.catalog.map((b: { id: string }) => b.id)).not.toContain(libId);

    // 4. Teacher sets visibility=public via the real sharing route.
    const pubRes = await sharingPatch(
      req('http://localhost/api/resources/sharing', {
        method: 'PATCH',
        cookie: teacherCookie,
        body: { kind: 'knowledge', id: libId, visibility: 'public', studentEmails: [] },
      }),
    );
    expect(pubRes.status).toBe(200);
    expect(await pubRes.json()).toEqual({ ok: true });

    // 5. Student A now sees the library as public.
    const aCatalog1 = await (await knowledgeGet(req('http://localhost/api/knowledge', { cookie: studentACookie }))).json();
    const aEntry = aCatalog1.catalog.find((b: { id: string }) => b.id === libId);
    expect(aEntry, 'student A should see the public library').toBeDefined();
    expect(aEntry.visibility).toBe('public');
    expect(aEntry.sharedWithMe).toBe(false);
    expect(aEntry.canEdit).toBe(false);

    // 6. Teacher revokes by switching to private.
    const privRes = await sharingPatch(
      req('http://localhost/api/resources/sharing', {
        method: 'PATCH',
        cookie: teacherCookie,
        body: { kind: 'knowledge', id: libId, visibility: 'private', studentEmails: [] },
      }),
    );
    expect(privRes.status).toBe(200);

    const aCatalog2 = await (await knowledgeGet(req('http://localhost/api/knowledge', { cookie: studentACookie }))).json();
    expect(aCatalog2.catalog.find((b: { id: string }) => b.id === libId)).toBeUndefined();

    // 7. Teacher shares privately to student A only.
    const shareRes = await sharingPatch(
      req('http://localhost/api/resources/sharing', {
        method: 'PATCH',
        cookie: teacherCookie,
        body: { kind: 'knowledge', id: libId, visibility: 'private', studentEmails: [studentA.email] },
      }),
    );
    expect(shareRes.status).toBe(200);

    // 8. Student A sees it as sharedWithMe=true; student B does not.
    const aCatalog3 = await (await knowledgeGet(req('http://localhost/api/knowledge', { cookie: studentACookie }))).json();
    const aShared = aCatalog3.catalog.find((b: { id: string }) => b.id === libId);
    expect(aShared, 'student A should now see the shared library').toBeDefined();
    expect(aShared.sharedWithMe).toBe(true);
    expect(aShared.canEdit).toBe(false);

    const bCatalog = await (await knowledgeGet(req('http://localhost/api/knowledge', { cookie: studentBCookie }))).json();
    expect(bCatalog.catalog.find((b: { id: string }) => b.id === libId)).toBeUndefined();

    // 9. GET share settings back from the teacher perspective.
    const getRes = await sharingGet(
      req(`http://localhost/api/resources/sharing?kind=knowledge&id=${libId}`, { cookie: teacherCookie }),
    );
    expect(getRes.status).toBe(200);
    const shareInfo = await getRes.json();
    expect(shareInfo.visibility).toBe('private');
    expect(shareInfo.students.map((s: { email: string }) => s.email)).toEqual([studentA.email]);

    // 10. Student A tries to edit the library — must be rejected (read-only).
    //     `updateLibrary` is dispatched on POST, not PATCH (PATCH only handles
    //     graph edits, document body updates, and review status changes).
    const editRes = await knowledgePost(
      req('http://localhost/api/knowledge', {
        method: 'POST',
        cookie: studentACookie,
        body: { action: 'updateLibrary', id: libId, title: 'hijacked' },
      }),
    );
    expect(editRes.status).toBe(403);

    // 11. Non-existent library in share URL → 404.
    const fakeRes = await sharingPatch(
      req('http://localhost/api/resources/sharing', {
        method: 'PATCH',
        cookie: teacherCookie,
        body: { kind: 'knowledge', id: 'lib-does-not-exist', visibility: 'public', studentEmails: [] },
      }),
    );
    expect(fakeRes.status).toBe(404);

    // 12. Student tries to set sharing on teacher's library → 403.
    const studRes = await sharingPatch(
      req('http://localhost/api/resources/sharing', {
        method: 'PATCH',
        cookie: studentACookie,
        body: { kind: 'knowledge', id: libId, visibility: 'public', studentEmails: [] },
      }),
    );
    expect(studRes.status).toBe(403);

    // 13. Unknown email in studentEmails → 400 with the existing "未注册" error.
    const badEmail = await sharingPatch(
      req('http://localhost/api/resources/sharing', {
        method: 'PATCH',
        cookie: teacherCookie,
        body: { kind: 'knowledge', id: libId, visibility: 'private', studentEmails: ['nope@nowhere.test'] },
      }),
    );
    expect(badEmail.status).toBe(400);
    const badJson = await badEmail.json();
    expect(badJson.error).toMatch(/未注册/);

    // 14. After invalidating the teacher's session row directly, the
    //     previously-issued session cookie is no longer valid. The
    //     knowledge route still returns 200, but the catalog is empty
    //     (the route falls back to the anonymous owner scope, which
    //     has no claim on teacher's bundle).
    await pool.query(`DELETE FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [teacher.email]);
    const afterInvalidate = await knowledgeGet(req('http://localhost/api/knowledge', { cookie: teacherCookie }));
    expect(afterInvalidate.status).toBe(200);
    const afterJson = await afterInvalidate.json();
    expect(afterJson.catalog.find((b: { id: string }) => b.id === libId)).toBeUndefined();
  }, 120_000);
});
