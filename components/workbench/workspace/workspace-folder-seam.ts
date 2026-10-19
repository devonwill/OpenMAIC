/**
 * 本文件：工作台课程文件夹的服务端适配层。
 * 职责：封装文件夹的创建、重命名、删除（保留课程）三个 API 请求，
 * 并把服务端错误码翻译为可判定的错误类型。
 * 关键点：删除用 ?mode=ungroup，只解组不清课程；错误码统一映射到
 * WorkspaceFolderNameError.kind 供 UI 分支提示。
 */
/** Folder integration for the workspace rail's server-backed course tree. */
/** 文件夹操作适配器接口：rail 侧只依赖此契约，不直接碰 fetch。 */
export interface WorkspaceFolderAdapter {
  readonly create: (name: string) => Promise<void>;
  readonly rename: (folderId: string, name: string) => Promise<void>;
  readonly removeKeepingCourses: (folderId: string) => Promise<void>;
}

/** 文件夹名校验错误：kind 标明具体原因，供 UI 映射到对应提示语。 */
export class WorkspaceFolderNameError extends Error {
  constructor(
    readonly kind: 'duplicate' | 'tooLong' | 'empty' | 'invalid' | 'limit',
    message: string = kind,
  ) {
    super(message);
    this.name = 'WorkspaceFolderNameError';
  }
}

type FolderErrorBody = { error?: { code?: unknown; message?: unknown } };

const ERROR_KINDS = {
  FOLDER_NAME_DUPLICATE: 'duplicate',
  FOLDER_NAME_TOO_LONG: 'tooLong',
  FOLDER_NAME_EMPTY: 'empty',
  FOLDER_NAME_INVALID: 'invalid',
  FOLDER_LIMIT_REACHED: 'limit',
} as const satisfies Record<string, WorkspaceFolderNameError['kind']>;

// 统一请求入口：非 2xx 时解析错误体，已知错误码抛类型化异常，
// 未知错误保留服务端 message，保证 UI 能区分「可修正的输入错误」与「系统错误」。
async function folderRequest(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, init);
  if (response.ok) return;

  const body = (await response.json().catch(() => null)) as FolderErrorBody | null;
  const code = typeof body?.error?.code === 'string' ? body.error.code : '';
  const kind: WorkspaceFolderNameError['kind'] | undefined =
    ERROR_KINDS[code as keyof typeof ERROR_KINDS];
  if (kind) {
    throw new WorkspaceFolderNameError(
      kind,
      typeof body?.error?.message === 'string' ? body.error.message : code,
    );
  }
  throw new Error(
    typeof body?.error?.message === 'string'
      ? body.error.message
      : `folder request failed (${response.status})`,
  );
}

/** 默认适配器实现：直接打 /api/folders 的增改删。 */
export const workspaceFolderAdapter: WorkspaceFolderAdapter = {
  create: (name) =>
    folderRequest('/api/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  rename: (folderId, name) =>
    folderRequest(`/api/folders/${encodeURIComponent(folderId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  removeKeepingCourses: (folderId) =>
    folderRequest(`/api/folders/${encodeURIComponent(folderId)}?mode=ungroup`, {
      method: 'DELETE',
    }),
};

// 能力探测：适配器存在即视为文件夹功能可用（为将来可插拔留口子）。
export const workspaceFoldersAvailable = (): boolean => workspaceFolderAdapter !== null;
