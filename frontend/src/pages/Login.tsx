import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { LanguageSelect } from '../components/LanguageSelect';

export function Login() {
  const { session, login, ready } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (ready && session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/orders';
    return <Navigate to={from} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/60 bg-white/70 shadow-[0_30px_80px_rgba(37,99,235,0.12)] backdrop-blur-xl md:grid-cols-2">
        <div className="hidden md:flex flex-col justify-between bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 p-8 text-white">
          <div>
            <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium backdrop-blur-sm">
              <span className="text-xl">🧺</span>
              LaundryPro
            </div>
            <h1 className="max-w-xs text-4xl font-black leading-tight">Fresh clothes. Faster service. Happier customers.</h1>
          </div>

          <div className="space-y-4 text-sm text-blue-50/90">
            <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-lg">🧼</span>
              <div>
                <p className="font-semibold text-white">Clean & tracked</p>
                <p>Monitor every order from wash to delivery.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-lg">💸</span>
              <div>
                <p className="font-semibold text-white">Smart billing</p>
                <p>Automatic totals and transparent reports.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-8 lg:p-10">
          <div className="mb-8 text-center md:text-left">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-500 text-3xl text-white shadow-lg shadow-brand-600/25 md:mx-0">🧺</div>
            <h2 className="text-2xl font-black text-slate-900">{t('login')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('tagline')}</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">{t('emailOrPhone')}</label>
              <input
                id="email"
                className="field"
                type="text"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">{t('password')}</label>
              <input
                id="password"
                className="field"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? t('signingIn') : t('login')}
            </button>
          </form>

          <div className="mt-6 flex justify-center md:justify-start">
            <LanguageSelect />
          </div>
        </div>
      </div>
    </div>
  );
}
