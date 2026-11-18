import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, errorMessage, tokenStore } from '../services/api';
import type { User } from '../types';

interface AuthValue {
  user: User | null;
  loading: boolean;
  sessionError: string; // set when the session could not be checked (server unreachable)
  retrySession: () => void;
  isStaff: boolean; // admin or editor
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => Boolean(tokenStore.get()));

  const [sessionError, setSessionError] = useState('');
  const [attempt, setAttempt] = useState(0);

  // Checks the stored token. Only a 401 means "signed out"; if the server is
  // briefly unreachable (for example while it restarts) we retry instead of
  // sending the user to the sign-in page.
  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setSessionError('');
    (async () => {
      for (let i = 0; i < 5 && !cancelled; i += 1) {
        try {
          const r = await api.get<{ user: User }>('/auth/me');
          if (!cancelled) setUser(r.user);
          break;
        } catch (e) {
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            if (!cancelled) setUser(null);
            break;
          }
          if (i === 4) {
            if (!cancelled) setSessionError(errorMessage(e));
          } else {
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retrySession = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const setSession = useCallback((token: string, u: User) => {
    tokenStore.set(token);
    setSessionError('');
    setUser(u);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
      setSession(r.token, r.user);
    },
    [setSession],
  );

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      sessionError,
      retrySession,
      isStaff: user?.role === 'admin' || user?.role === 'editor',
      isAdmin: user?.role === 'admin',
      login,
      logout,
      setSession,
      setUser,
    }),
    [user, loading, sessionError, retrySession, login, logout, setSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
