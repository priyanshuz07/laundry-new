import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onUnauthorized, setToken, type Role } from './api';

const STORAGE_KEY = 'lms.session';

interface Session {
  token: string;
  role: Role;
  name: string;
  userId: string;
}

interface AuthValue {
  session: Session | null;
  isAdmin: boolean;
  ready: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    const stored = readSession();
    setToken(stored?.token ?? null);
    return stored;
  });
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setSession(null);
  }, []);

  useEffect(() => {
    onUnauthorized(logout);
  }, [logout]);

  // Validate a restored token once on boot so a revoked account cannot sit on a stale UI.
  useEffect(() => {
    let cancelled = false;
    async function verify() {
      if (!session) {
        setReady(true);
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) setSession((prev) => (prev ? { ...prev, role: me.role, name: me.name } : prev));
      } catch {
        if (!cancelled) logout();
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void verify();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const res = await api.login(phone, password);
    const next: Session = { token: res.access_token, role: res.role, name: res.name, userId: res.user_id };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setToken(next.token);
    setSession(next);
  }, []);

  const value = useMemo(
    () => ({ session, isAdmin: session?.role === 'admin', ready, login, logout }),
    [session, ready, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
