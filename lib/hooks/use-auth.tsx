'use client';

// 客户端登录态唯一来源（Task 9）：启动时 GET /api/auth/me 拉当前用户，
// 供访问码守卫（双轨：已登录免访问码）和后续 Task 10/11 的用户菜单、
// 教师配置同步共享，避免各组件各自请求 /me 导致状态漂移。

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  role: 'teacher' | 'student';
  displayName: string;
  phone: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  refresh: async () => null,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = await res.json();
      const next = data?.user ?? null;
      setUser(next);
      return next;
    } catch {
      // /me 网络失败按「游客」处理而非报错：与服务端未登录口径一致，
      // 宁可退回访问码流程，也不让一次请求失败把已登录用户锁在页面外。
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    // 登出失败也要清本地态：cookie 可能已过期，客户端保持「已登录」只会误导 UI。
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
