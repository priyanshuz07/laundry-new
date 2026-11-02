import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { demoAuth, type DemoSession } from './api';

interface AuthValue {
  session: DemoSession | null;
  isAdmin: boolean;
  ready: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function readSession(): DemoSession | null {
  try {
    return demoAuth.readSession();
  } catch {
    demoAuth.clearSession();
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DemoSession | null>(readSession);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    demoAuth.clearSession();
    setSession(null);
  }, []);

  useEffect(() => {
    setReady(true);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const next = await demoAuth.login(identifier, password);
    demoAuth.saveSession(next);
    setSession(next);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const next = await demoAuth.register(name, email, password);
    demoAuth.saveSession(next);
    setSession(next);
  }, []);

  const value = useMemo(
    () => ({ session, isAdmin: session?.role === 'admin', ready, login, register, logout }),
    [session, ready, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
