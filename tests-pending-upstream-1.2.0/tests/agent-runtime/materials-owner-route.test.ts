import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// 骨架照抄 materials-route.test.ts；owner-materials 不 mock（真实模块，
// SQL 打到 queryPool.mock 上），这样列表/改名/软删的过滤条件由真实 SQL 决定。
const mocks = vi.hoisted(() => ({
  runtimeConfigured: true,
  resolveRequestOwnerId: vi.fn(),
  resolveOwnedSession: vi.fn(),
  listSessionMaterials: vi.fn(),
  createSourceMaterial: vi.fn(),
  byteStore: {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
  queryPool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('@/lib/config/feature-flags', () => ({
  isAgentRuntimeConfigured: () => mocks.runtimeConfigured,
}));
vi.mock('@/lib/server/agent-runtime/owner', () => ({
  resolveRequestOwnerId: mocks.resolveRequestOwnerId,
}));
vi.mock('@/lib/server/agent-runtime/session-materials', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/agent-runtime/session-materials')>();
  return {
    ...actual,
    resolveOwnedSession: mocks.resolveOwnedSession,
    listSessionMaterials: mocks.listSessionMaterials,
    createSourceMaterial: mocks.createSourceMaterial,
  };
});
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: mocks.queryPool,
  }),
}));
vi.mock('@/lib/server/materials/bytes', () => ({
  getMaterialByteStore: () => mocks.byteStore,
}));

import { GET as listMaterials } from '@/app/api/materials/route';
import { DELETE as deleteMaterial, PATCH as patchMaterial } from '@/app/api/materials/[id]/route';
import { GET as readMaterialBytes } from '@/app/api/materials/[id]/bytes/route';

const MATERIAL_ID = 'mat_00000000000000000000000000';
const OSS_KEY = `materials/owner-1/${MATERIAL_ID}`;

/** owner_material 的 snake_case 行（queryPool 返回的真实形状）。 */
interface RawRow {
  id: string;
  owner_id: string;
  kind: string;
  derived_from: string | null;
  mime: string | null;
  bytes: number;
  original_name: string | null;
  oss_key: string;
  sha256: string | null;
  status: string;
  extraction: { status: string } | null;
  created_at: number;
  deleted_at: number | null;
}

function rawRow(overrides: Partial<RawRow> = {}): RawRow {
  return {
    id: MATERIAL_ID,
    owner_id: 'owner-1',
    kind: 'source',
    derived_from: null,
    mime: 'application/pdf',
    bytes: 5,
    original_name: '讲义.pdf',
    oss_key: OSS_KEY,
    sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    status: 'ready',
    extraction: { status: 'idle' },
    created_at: 1_700_000_000_000,
    deleted_at: null,
    ...overrides,
  };
}

/** publicMaterial 对 rawRow() 的投影，断言用的预期 JSON 形状。 */
const PUBLIC_VIEW = {
  materialId: MATERIAL_ID,
  kind: 'source',
  mime: 'application/pdf',
  bytes: 5,
  originalName: '讲义.pdf',
  extraction: { status: 'idle' },
  createdAt: '2023-11-14T22:13:20.000Z',
};

function patchReq(body: unknown, id = MATERIAL_ID) {
  return patchMaterial(
    new NextRequest(`http://localhost/api/materials/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function deleteReq(id = MATERIAL_ID) {
  return deleteMaterial(new NextRequest(`http://localhost/api/materials/${id}`, {
    method: 'DELETE',
  }), { params: Promise.resolve({ id }) });
}

function bytesReq(id = MATERIAL_ID) {
  return readMaterialBytes(new NextRequest(`http://localhost/api/materials/${id}/bytes`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtimeConfigured = true;
  mocks.resolveRequestOwnerId.mockReturnValue('owner-1');
  mocks.resolveOwnedSession.mockResolvedValue(null);
  mocks.listSessionMaterials.mockResolvedValue([]);
  mocks.byteStore.get.mockResolvedValue(Buffer.alloc(0));
  mocks.byteStore.delete.mockResolvedValue(undefined);
  // 默认空结果：各用例按需覆盖（mockResolvedValue 会覆盖这里的实现）。
  mocks.queryPool.query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  // 恢复用例内的 console spy，避免告警/错误日志泄漏到其他用例。
  vi.restoreAllMocks();
});

describe('GET /api/materials?scope=owner', () => {
  it('未配置 runtime 返回 404', async () => {
    mocks.runtimeConfigured = false;
    const response = await listMaterials(new NextRequest('http://localhost/api/materials?scope=owner'));
    expect(response.status).toBe(404);
    expect(mocks.queryPool.query).not.toHaveBeenCalled();
  });

  it('缺 owner 返回 404（ownerNotFound 语义）', async () => {
    mocks.resolveRequestOwnerId.mockReturnValue(null);
    const response = await listMaterials(new NextRequest('http://localhost/api/materials?scope=owner'));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
    expect(mocks.queryPool.query).not.toHaveBeenCalled();
  });

  it('返回 owner 素材列表且过滤 deleted_at', async () => {
    const live = rawRow();
    const deleted = rawRow({ id: 'mat_11111111111111111111111111', deleted_at: 1_700_000_100_000 });
    // mock 不执行真 SQL，只能按语句文本模拟数据库的软删过滤：
    // 真实 SQL 带 deleted_at IS NULL 才返回未删行，丢了过滤条件则已删行也会出现。
    mocks.queryPool.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('deleted_at IS NULL') ? [live] : [live, deleted],
    }));

    // owner 列表不依赖 sessionId：不带 sessionId 也不能 400。
    const response = await listMaterials(new NextRequest('http://localhost/api/materials?scope=owner'));
    expect(response.status).toBe(200);

    const [sql, params] = mocks.queryPool.query.mock.calls[0]!;
    expect(sql).toContain('deleted_at IS NULL');
    expect(params).toEqual(['owner-1']);
    await expect(response.json()).resolves.toEqual({ materials: [PUBLIC_VIEW] });
  });

  it('按 limit 截断列表', async () => {
    mocks.queryPool.query.mockResolvedValue({
      rows: [rawRow(), rawRow({ id: 'mat_22222222222222222222222222', created_at: 1_699_999_000_000 })],
    });
    const response = await listMaterials(
      new NextRequest('http://localhost/api/materials?scope=owner&limit=1'),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { materials: Array<{ materialId: string }> };
    expect(body.materials).toHaveLength(1);
    expect(body.materials[0]!.materialId).toBe(MATERIAL_ID);
  });

  it('拒绝非法 limit', async () => {
    const response = await listMaterials(
      new NextRequest('http://localhost/api/materials?scope=owner&limit=abc'),
    );
    expect(response.status).toBe(400);
    expect(mocks.queryPool.query).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/materials/:id（owner 级）', () => {
  it('空名或超 512 字符返回 400', async () => {
    const blank = await patchReq({ originalName: '  ' });
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toMatchObject({ errorCode: 'INVALID_REQUEST' });

    const tooLong = await patchReq({ originalName: 'x'.repeat(600) });
    expect(tooLong.status).toBe(400);
    expect(mocks.queryPool.query).not.toHaveBeenCalled();
  });

  it('不存在返回 404', async () => {
    mocks.queryPool.query.mockResolvedValue({ rows: [] });
    const response = await patchReq({ originalName: '新名.pdf' });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
  });

  it('成功返回更新后的视图', async () => {
    mocks.queryPool.query.mockResolvedValue({
      rows: [rawRow({ original_name: '重命名.pdf' })],
    });
    const response = await patchReq({ originalName: '  重命名.pdf  ' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      material: { ...PUBLIC_VIEW, originalName: '重命名.pdf' },
    });
    // UPDATE 必须限定本 owner 并写入 trim 后的名字。
    const [sql, params] = mocks.queryPool.query.mock.calls[0]!;
    expect(sql).toContain('owner_id = $1');
    expect(sql).toContain('original_name = $3');
    expect(params).toEqual(['owner-1', MATERIAL_ID, '重命名.pdf']);
  });

  it('未配置 runtime 返回 404', async () => {
    mocks.runtimeConfigured = false;
    const response = await patchReq({ originalName: 'x.pdf' });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/materials/:id（owner 级）', () => {
  it('软删并尽力清理字节：byteStore.delete 失败仍返回 200', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.queryPool.query.mockResolvedValue({ rows: [rawRow()] });
    mocks.byteStore.delete.mockRejectedValue(new Error('byte store unavailable'));

    const response = await deleteReq();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    // 软删返回行携带 oss_key，清理用的正是被删行的键。
    expect(mocks.byteStore.delete).toHaveBeenCalledWith(OSS_KEY);
    expect(warn).toHaveBeenCalled();
    const [sql, params] = mocks.queryPool.query.mock.calls[0]!;
    expect(sql).toContain('deleted_at');
    expect(params.slice(0, 2)).toEqual(['owner-1', MATERIAL_ID]);
  });

  it('不存在返回 404', async () => {
    mocks.queryPool.query.mockResolvedValue({ rows: [] });
    const response = await deleteReq();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
    expect(mocks.byteStore.delete).not.toHaveBeenCalled();
  });

  it('未配置 runtime 返回 404', async () => {
    mocks.runtimeConfigured = false;
    const response = await deleteReq();
    expect(response.status).toBe(404);
  });
});

describe('GET /api/materials/:id/bytes', () => {
  it('未命中所有权返回 404', async () => {
    mocks.queryPool.query.mockResolvedValue({ rows: [] });
    const response = await bytesReq();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
    expect(mocks.byteStore.get).not.toHaveBeenCalled();
  });

  it('命中返回字节并保留 content-type 与 Set-Cookie', async () => {
    // owner 解析产出的 Set-Cookie 必须 rides 字节响应（重试保持同一 owner 分区）。
    mocks.resolveRequestOwnerId.mockImplementation((_req, responseHeaders: Headers) => {
      responseHeaders.set('Set-Cookie', 'anonymous_id=anon-2; Path=/');
      return 'owner-1';
    });
    mocks.queryPool.query.mockResolvedValue({ rows: [rawRow()] });
    mocks.byteStore.get.mockResolvedValue(Buffer.from('fake'));

    const response = await bytesReq();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('private, max-age=60');
    expect(response.headers.get('set-cookie')).toContain('anonymous_id=anon-2');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('fake');
    expect(mocks.byteStore.get).toHaveBeenCalledWith(OSS_KEY);
  });

  it('字节缺失（ENOENT）返回 404', async () => {
    mocks.queryPool.query.mockResolvedValue({ rows: [rawRow()] });
    mocks.byteStore.get.mockRejectedValue(
      Object.assign(new Error('missing bytes'), { code: 'ENOENT' }),
    );
    const response = await bytesReq();
    expect(response.status).toBe(404);
  });

  it('非 ENOENT 错误向上抛并答 500（不静默吞）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.queryPool.query.mockResolvedValue({ rows: [rawRow()] });
    mocks.byteStore.get.mockRejectedValue(new Error('byte store down'));
    const response = await bytesReq();
    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalled();
  });
});
