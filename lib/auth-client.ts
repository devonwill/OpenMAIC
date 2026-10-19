export interface AuthUser {
  id: string;
  email: string;
  role: 'teacher' | 'student';
  displayName: string;
  phone: string | null;
  /** 头像：内置路径（/avatars/*.svg）或 data:image/...;base64,... 内联图（≤ 200KB）。 */
  avatar: string | null;
}

export interface AuthSnapshot {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

/**
 * 内置卡通头像列表。用户可以从这套图片里直接挑一张，
 * 也可以拍照/选本地图片上传（前端转 data URL 后再调用 me PATCH）。
 * 与 lib/store/user-profile.ts 的 AVATAR_OPTIONS 同源——以后做去重时建议把
 * 这份提到 lib/avatars.ts 常量里双向引用。
 */
export const AVATAR_OPTIONS = [
  '/avatars/user.png',
  '/avatars/teacher-2.png',
  '/avatars/assist-2.png',
  '/avatars/clown-2.png',
  '/avatars/curious-2.png',
  '/avatars/note-taker-2.png',
  '/avatars/thinker-2.png',
  '/avatars/学生01_男生.svg',
  '/avatars/学生02_女生.svg',
  '/avatars/学生03_男生.svg',
  '/avatars/学生04_女生.svg',
  '/avatars/学生05_男生.svg',
  '/avatars/学生06_女生.svg',
  '/avatars/学生07_男生.svg',
  '/avatars/学生08_女生.svg',
  '/avatars/学生09_男生.svg',
  '/avatars/学生10_女生.svg',
  '/avatars/学生11_男生.svg',
  '/avatars/学生12_女生.svg',
  '/avatars/教师01_男教师.svg',
  '/avatars/教师02_女教师.svg',
  '/avatars/教师03_男教师.svg',
  '/avatars/教师04_女教师.svg',
  // 新增 32 张卡通头像：学生 24 张 + 教师 8 张
  '/avatars/student4.png',
  '/avatars/student5.png',
  '/avatars/student6.png',
  '/avatars/student7.png',
  '/avatars/student8.png',
  '/avatars/student9.png',
  '/avatars/student10.png',
  '/avatars/student11.png',
  '/avatars/student12.png',
  '/avatars/student13.png',
  '/avatars/student14.png',
  '/avatars/student15.png',
  '/avatars/student16.png',
  '/avatars/student17.png',
  '/avatars/student18.png',
  '/avatars/student19.png',
  '/avatars/student20.png',
  '/avatars/student21.png',
  '/avatars/student22.png',
  '/avatars/student23.png',
  '/avatars/student24.png',
  '/avatars/student25.png',
  '/avatars/student26.png',
  '/avatars/student27.png',
  '/avatars/teacher-3.png',
  '/avatars/teacher-4.png',
  '/avatars/teacher-5.png',
  '/avatars/teacher-6.png',
  '/avatars/teacher-7.png',
  '/avatars/teacher-8.png',
  '/avatars/teacher-9.png',
  '/avatars/teacher-10.png',
] as const;

/** 单张头像最大长度：data URL 上限 ≈ 200KB（≈ 150KB 解码后），够 256×256 PNG。 */
const AVATAR_MAX_LENGTH = 200 * 1024;

/**
 * 校验用户上传/选择的 avatar 是否合法：
 * - 内置路径（必须命中 AVATAR_OPTIONS，避免被诱导指到 /api/* 等敏感路径）；
 * - 外链 http(s) URL；
 * - 小尺寸 data URL（仅 image/*）。
 * 不接受任意相对路径，防止通过头像字段做本地路径穿越。
 */
export function isValidAvatar(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > AVATAR_MAX_LENGTH) {
    return false;
  }
  if ((AVATAR_OPTIONS as readonly string[]).includes(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(value)) return true;
  return false;
}
const INITIAL: AuthSnapshot = { user: null, loading: true, error: null };

/** A request generation prevents old /me responses from undoing login/logout. */
export function createAuthClient(fetcher: typeof fetch = (...args) => fetch(...args)) {
  let snapshot = INITIAL;
  let generation = 0;
  let logoutPending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  function publish(next: AuthSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  async function refresh(): Promise<AuthUser | null> {
    if (logoutPending) {
      await logoutPending.catch(() => undefined);
      return snapshot.user;
    }
    const request = ++generation;
    try {
      const res = await fetcher('/api/auth/me', { cache: 'no-store' });
      if (!res.ok && res.status !== 401) throw new Error('无法确认登录状态，请稍后重试');
      const data = res.status === 401 ? { user: null } : await res.json();
      if (!data || !('user' in data)) throw new Error('登录状态响应无效');
      if (request === generation) publish({ user: data.user ?? null, loading: false, error: null });
    } catch (error) {
      if (request === generation)
        publish({
          ...snapshot,
          loading: false,
          error: error instanceof Error ? error.message : '无法确认登录状态',
        });
    }
    return snapshot.user;
  }
  function logout(): Promise<void> {
    if (logoutPending) return logoutPending;
    ++generation;
    logoutPending = (async () => {
      try {
        const res = await fetcher('/api/auth/logout', { method: 'POST' });
        if (!res.ok) throw new Error('退出登录失败，请重试');
        publish({ user: null, loading: false, error: null });
      } catch {
        const error = '退出登录失败，请检查网络后重试';
        publish({ ...snapshot, loading: false, error });
        throw new Error(error);
      } finally {
        logoutPending = undefined;
      }
    })();
    return logoutPending;
  }
  /**
   * 本地缓存同步：在用户成功保存了头像/昵称后，绕过 /me 直接把新 user 写进 store，
   * 避免组件（顶栏头像、菜单里的姓名）依赖下一次 refresh 才更新造成闪烁。
   * 与 refresh 互不影响 generation——它不打断正在飞的 /me 请求。
   */
  function setUser(next: AuthUser | null): void {
    publish({ user: next, loading: false, error: null });
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    logout,
    setUser,
    invalidate() {
      ++generation;
    },
  };
}
