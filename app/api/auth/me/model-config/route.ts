import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getAuthDb } from '@/lib/server/auth/db';
import { getTeacherModelConfig, saveTeacherModelConfig } from '@/lib/server/auth/store';
import { decryptSecret, encryptSecret } from '@/lib/server/auth/secret-box';
import { currentUser } from '@/lib/server/auth/current-user';
import type { ProvidersConfig } from '@/lib/types/settings';

// 教师专用：providersConfig（含 API Key）加密落库，登录跨设备恢复。
// 学生与未登录一律 401/403，与 spec Q9（学生配置仅存本地）一致。

export async function GET() {
  const found = await currentUser();
  if (!found) return apiError('UNAUTHENTICATED', 401, 'login required');
  if (found.user.role !== 'teacher') {
    return apiError('INVALID_CREDENTIALS', 403, 'cloud model config sync is teacher-only');
  }
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return apiError('INTERNAL_ERROR', 503, 'ENCRYPTION_KEY is not configured');

  const db = await getAuthDb();
  if (!db) return apiError('INTERNAL_ERROR', 503, 'user accounts require DATABASE_URL');
  const ciphertext = await getTeacherModelConfig(db, found.user.id);
  if (ciphertext === null) return apiSuccess({ providersConfig: null });
  try {
    const providersConfig = JSON.parse(decryptSecret(ciphertext, key)) as ProvidersConfig;
    return apiSuccess({ providersConfig });
  } catch {
    // 解密失败=密文被篡改或 KEY 轮换过：明确报错而不是返回半截数据。
    return apiError('INTERNAL_ERROR', 500, 'stored model config could not be decrypted');
  }
}

const MAX_CONFIG_CHARS = 1_000_000; // ~1MB：覆盖十余个 provider 的模型清单足够。

export async function PUT(request: Request) {
  const found = await currentUser();
  if (!found) return apiError('UNAUTHENTICATED', 401, 'login required');
  if (found.user.role !== 'teacher') {
    return apiError('INVALID_CREDENTIALS', 403, 'cloud model config sync is teacher-only');
  }
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return apiError('INTERNAL_ERROR', 503, 'ENCRYPTION_KEY is not configured');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'invalid JSON body');
  }
  const { providersConfig } = (body ?? {}) as Record<string, unknown>;
  if (typeof providersConfig !== 'object' || providersConfig === null || Array.isArray(providersConfig)) {
    return apiError('INVALID_REQUEST', 400, 'providersConfig must be an object');
  }
  if (JSON.stringify(providersConfig).length > MAX_CONFIG_CHARS) {
    return apiError('INVALID_REQUEST', 413, 'providersConfig too large');
  }

  const db = await getAuthDb();
  if (!db) return apiError('INTERNAL_ERROR', 503, 'user accounts require DATABASE_URL');
  // AES-256-GCM 落库；UPSERT last-write-wins 由 store.saveTeacherModelConfig 保证。
  const ciphertext = encryptSecret(JSON.stringify(providersConfig), key);
  await saveTeacherModelConfig(db, found.user.id, ciphertext);
  return apiSuccess({ saved: true });
}
