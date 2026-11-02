import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useI18n } from '../i18n';

const EMPTY_FORM = { name: '', username: '', phone: '', password: '', confirmPassword: '' };

export function Staff() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApi(() => api.users(), []);
  const [form, setForm] = useState(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subAdmins = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? [])
      .filter((user) => user.role === 'subadmin')
      .filter((user) =>
        !term || [user.name, user.username ?? '', user.phone ?? ''].some((value) => value.toLowerCase().includes(term)),
      );
  }, [data, search]);

  async function create() {
    setActionError(null);
    setSuccess(null);
    if (
      !form.name.trim() ||
      !/^[a-z0-9._-]{3,32}$/i.test(form.username.trim()) ||
      !/[a-z]/i.test(form.username.trim()) ||
      form.password.length < 8
    ) {
      setActionError(t('requiredFields'));
      return;
    }
    if (form.password !== form.confirmPassword) {
      setActionError(t('passwordsMismatch'));
      return;
    }
    if (form.phone && (form.phone.length < 10 || form.phone.length > 15)) {
      setActionError(t('phoneDigitsError'));
      return;
    }

    setBusy(true);
    try {
      await api.createUser({
        name: form.name.trim(),
        username: form.username.trim().toLowerCase(),
        ...(form.phone ? { phone: form.phone } : {}),
        password: form.password,
      });
      setForm(EMPTY_FORM);
      setOpen(false);
      setSuccess(t('subAdminCreated'));
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    setActionError(null);
    setSuccess(null);
    if (!active && !window.confirm(t('confirmDeactivateSubAdmin'))) return;
    setBusy(true);
    try {
      await api.setUserActive(id, active);
      setSuccess(active ? t('subAdminActivated') : t('subAdminDeactivated'));
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">Access</p>
          <h1 className="page-title">{t('subAdminManagement')}</h1>
        </div>
        <button
          type="button"
          className="btn-primary px-3 py-2.5 text-sm"
          onClick={() => {
            setOpen((value) => !value);
            setActionError(null);
          }}
        >
          + {t('createSubAdmin')}
        </button>
      </div>

      {open && (
        <div className="card space-y-3">
          <div>
            <label className="label" htmlFor="subadmin-name">{t('fullName')} *</label>
            <input
              id="subadmin-name"
              className="field"
              autoComplete="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="subadmin-username">{t('subAdminId')} *</label>
            <input
              id="subadmin-username"
              className="field"
              autoComplete="username"
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })}
              minLength={3}
              maxLength={32}
              required
            />
            <p className="mt-1 text-xs text-slate-500">{t('usernameHelp')}</p>
          </div>
          <div>
            <label className="label" htmlFor="subadmin-phone">{t('optionalPhone')}</label>
            <input
              id="subadmin-phone"
              className="field"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={15}
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value.replace(/[^0-9]/g, '').slice(0, 15) })}
            />
          </div>
          <div>
            <label className="label" htmlFor="subadmin-password">{t('password')} *</label>
            <input
              id="subadmin-password"
              className="field"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              minLength={8}
              required
            />
            <p className="mt-1 text-xs text-slate-500">Minimum 8 characters.</p>
          </div>
          <div>
            <label className="label" htmlFor="subadmin-confirm-password">{t('confirmPassword')} *</label>
            <input
              id="subadmin-confirm-password"
              className="field"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              required
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-slate-600">{t('role')}: {t('subAdminRole')}</span>
            <button
              type="button"
              className="text-sm font-semibold text-brand-700 hover:text-brand-800"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? t('hidePassword') : t('showPassword')}
            </button>
          </div>
          <button type="button" className="btn-primary w-full" onClick={create} disabled={busy}>
            {busy ? t('saving') : t('createSubAdmin')}
          </button>
        </div>
      )}

      {(error || actionError) && (
        <div className="card text-sm text-red-700">{actionError ?? error}</div>
      )}
      {success && <div className="card text-sm text-emerald-700" role="status">{success}</div>}

      <div className="card">
        <label className="sr-only" htmlFor="subadmin-search">{t('searchSubAdmins')}</label>
        <input
          id="subadmin-search"
          className="field"
          type="search"
          placeholder={t('searchSubAdmins')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {loading && !data && <p className="p-6 text-center text-slate-500">{t('loading')}</p>}
      {!loading && !error && subAdmins.length === 0 && (
        <div className="empty-state">{search ? t('noMatchingSubAdmins') : t('noSubAdmins')}</div>
      )}

      <ul className="space-y-3">
        {subAdmins.map((user) => (
          <li key={user.id} className="list-card">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-sky-50 to-blue-100 text-lg font-bold text-brand-700 ring-1 ring-brand-100">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-slate-800">{user.name}</p>
              <p className="text-sm text-slate-600">{t('subAdminId')}: {user.username}</p>
              {user.phone && <p className="text-xs text-slate-500">{user.phone}</p>}
              <p className="text-xs text-slate-400">
                {t('subAdminRole')} · {t('createdDate')}: {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`pill ${user.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                {user.is_active ? t('active') : t('inactive')}
              </span>
              <button
                type="button"
                onClick={() => toggle(user.id, !user.is_active)}
                disabled={busy}
                className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                  user.is_active ? 'text-red-600 hover:bg-red-50' : 'text-emerald-700 hover:bg-emerald-50'
                }`}
              >
                {user.is_active ? t('deactivate') : t('activate')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
