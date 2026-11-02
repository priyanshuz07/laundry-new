import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { demoAuth, type DemoSession } from './api';

interface AuthValue {
  session: DemoSession | null;
  isAdmin: boolean;
  ready: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (name: string, email: string, phone: string, password: string) => Promise<void>;
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
    let active = true;
    const handleExpiredSession = () => {
      demoAuth.clearSession();
      setSession(null);
    };
    window.addEventListener('lms:session-expired', handleExpiredSession);
    const stored = demoAuth.readSession();
    if (!stored) {
      setReady(true);
      return () => {
        active = false;
        window.removeEventListener('lms:session-expired', handleExpiredSession);
      };
    }

    demoAuth
      .me()
      .then((current) => {
        if (active) {
          demoAuth.saveSession(current);
          setSession(current);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof Error && 'status' in error && [401, 403].includes(Number(error.status))) {
          demoAuth.clearSession();
          setSession(null);
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
      window.removeEventListener('lms:session-expired', handleExpiredSession);
    };
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const next = await demoAuth.login(identifier, password);
    demoAuth.saveSession(next);
    setSession(next);
  }, []);

  const register = useCallback(async (name: string, email: string, phone: string, password: string) => {
    const next = await demoAuth.register(name, email, phone, password);
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
