'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createAuthClient, type AuthUser, type AuthSnapshot } from '@/lib/auth-client';
export type { AuthUser } from '@/lib/auth-client';

interface AuthState extends AuthSnapshot {
  refresh: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
  setUser: (next: AuthUser | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => createAuthClient());
  const snapshot = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getServerSnapshot,
  );
  useEffect(() => {
    void client.refresh();
    return () => client.invalidate();
  }, [client]);
  return (
    <AuthContext.Provider
      value={{
        ...snapshot,
        refresh: client.refresh,
        logout: client.logout,
        setUser: client.setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error('useAuth requires AuthProvider');
  return state;
}
