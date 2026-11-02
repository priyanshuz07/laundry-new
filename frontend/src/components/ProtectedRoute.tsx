import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';

export function ProtectedRoute({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { session, isAdmin, ready } = useAuth();
  const location = useLocation();
  const { t } = useI18n();

  if (!ready) return <div className="p-8 text-center text-slate-500">{t('loading')}</div>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (adminOnly && !isAdmin) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="card text-center text-slate-700">{t('adminOnly')}</div>
      </div>
    );
  }
  return <>{children}</>;
}
