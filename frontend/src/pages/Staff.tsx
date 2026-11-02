import { useState } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useI18n } from '../i18n';

export function Staff() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApi(() => api.users(), []);
  const [form, setForm] = useState({ name: '', phone: '', password: '' });
  const [open, setOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setActionError(null);
    if (!form.name.trim() || form.phone.length < 10 || form.password.length < 8) {
      setActionError(t('requiredFields'));
      return;
    }
    setBusy(true);
    try {
      await api.createUser(form);
      setForm({ name: '', phone: '', password: '' });
      setOpen(false);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    setActionError(null);
    try {
      await api.setUserActive(id, active);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the account');
    }
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">Access</p>
          <h1 className="page-title">{t('staff')}</h1>
        </div>
        <button type="button" className="btn-primary px-3 py-2.5 text-sm" onClick={() => setOpen((v) => !v)}>
          + {t('createSubAdmin')}
        </button>
      </div>

      {open && (
        <div className="card space-y-3">
          <div>
            <label className="label">{t('customerName')} *</label>
            <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">{t('phone')} *</label>
            <input
              className="field"
              inputMode="numeric"
              maxLength={15}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^0-9]/g, '') })}
            />
          </div>
          <div>
            <label className="label">{t('password')} *</label>
            <input
              className="field"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <p className="mt-1 text-xs text-slate-500">Minimum 8 characters.</p>
          </div>
          <button type="button" className="btn-primary w-full" onClick={create} disabled={busy}>
            {busy ? t('saving') : t('save')}
          </button>
        </div>
      )}

      {(error || actionError) && (
        <div className="card text-sm text-red-700">{actionError ?? error}</div>
      )}
      {loading && !data && <p className="p-6 text-center text-slate-500">{t('loading')}</p>}

      <ul className="space-y-3">
        {data?.map((u) => (
          <li key={u.id} className="list-card">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-sky-50 to-blue-100 text-lg font-bold text-brand-700 ring-1 ring-brand-100">
              {u.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-slate-800">{u.name}</p>
              <p className="text-sm text-slate-600">{u.phone}</p>
              <p className="text-xs text-slate-400">{u.role}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`pill ${u.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                {u.is_active ? t('active') : t('inactive')}
              </span>
              {u.role === 'subadmin' && (
                <button
                  type="button"
                  onClick={() => toggle(u.id, !u.is_active)}
                  className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                    u.is_active ? 'text-red-600 hover:bg-red-50' : 'text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  {u.is_active ? t('deactivate') : t('activate')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
