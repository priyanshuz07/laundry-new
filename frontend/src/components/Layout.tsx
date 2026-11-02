import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { LanguageSelect } from './LanguageSelect';

export function Layout() {
  const { session, isAdmin, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const links = [
    { to: '/orders', label: t('orders') },
    { to: '/orders/new', label: t('newOrder') },
    { to: '/customers', label: t('customers') },
    ...(isAdmin
      ? [
          { to: '/reports', label: t('reports') },
          { to: '/staff', label: t('staff') },
        ]
      : []),
  ];

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell min-h-screen pb-20 md:pb-0">
      <header className="no-print sticky top-0 z-20 border-b border-white/40 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-500 text-xl text-white shadow-lg shadow-brand-600/25">🧺</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black uppercase tracking-[0.18em] text-slate-900">{t('appName')}</p>
              <p className="truncate text-xs text-slate-500">{session?.name}</p>
            </div>
          </div>
          <nav className="ml-auto hidden items-center gap-2 md:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/orders'}
                className={({ isActive }) =>
                  `rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    isActive ? 'bg-brand-50 text-brand-700 shadow-sm ring-1 ring-brand-100' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-2">
            <LanguageSelect />
            <button type="button" onClick={handleLogout} className="rounded-xl border border-slate-200 bg-white/80 px-2.5 py-2 text-sm font-medium text-slate-600 transition hover:border-red-200 hover:text-red-600">
              {t('logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>

      <nav className="no-print fixed inset-x-0 bottom-0 z-10 border-t border-slate-200/80 bg-white/85 backdrop-blur-xl md:hidden">
        <div className="flex">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/orders'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${
                  isActive ? 'text-brand-700' : 'text-slate-500'
                }`
              }
            >
              <span className="text-base leading-none">
                {l.to === '/orders' ? '📋' : l.to === '/orders/new' ? '➕' : l.to === '/customers' ? '👥' : l.to === '/reports' ? '📊' : '🔑'}
              </span>
              {l.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
