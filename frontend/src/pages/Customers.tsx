import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useI18n } from '../i18n';

export function Customers() {
  const { t } = useI18n();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(id);
  }, [term]);

  const { data, error: loadError, loading, reload } = useApi(() => api.customers(debounced), [debounced]);

  async function save() {
    setError(null);
    if (!form.name.trim() || form.phone.trim().length < 10) {
      setError(t('requiredFields'));
      return;
    }
    setBusy(true);
    try {
      await api.saveCustomer({ ...form, notes: '' });
      setForm({ name: '', phone: '', address: '' });
      setOpen(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the customer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">People</p>
          <h1 className="page-title">{t('customers')}</h1>
        </div>
        <button type="button" className="btn-primary px-3 py-2.5 text-sm" onClick={() => setOpen((v) => !v)}>
          + {t('save')}
        </button>
      </div>

      <div className="card p-3">
        <input
          className="field"
          type="search"
          placeholder={t('searchPlaceholder')}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
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
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^0-9]/g, '') })}
              maxLength={15}
            />
          </div>
          <div>
            <label className="label">{t('address')}</label>
            <input className="field" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button type="button" className="btn-primary w-full" onClick={save} disabled={busy}>
            {busy ? t('saving') : t('save')}
          </button>
        </div>
      )}

      {loadError && <div className="card text-sm text-red-700">{loadError}</div>}
      {loading && !data && <p className="p-6 text-center text-slate-500">{t('loading')}</p>}
      {data && data.length === 0 && !loading && (
        <div className="empty-state">{t('noCustomers')}</div>
      )}

      <ul className="space-y-3">
        {data?.map((c) => (
          <li key={c.id} className="list-card">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-blue-100 text-lg font-bold text-brand-700 ring-1 ring-brand-100">
              {c.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-slate-800">{c.name}</p>
              <p className="text-sm text-slate-600">{c.phone}</p>
              {c.address && <p className="truncate text-xs text-slate-400">{c.address}</p>}
            </div>
            <span className="pill bg-slate-100 text-slate-600">
              {c.order_count} {t('totalOrders')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
