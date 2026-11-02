import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fromPaise, rupees, toPaise } from '../lib/money';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';

interface Row {
  key: string;
  name: string;
  category: string;
  quality: 'normal' | 'premium' | 'delicate';
  quantity: number;
  priceRupees: string;
}

const QUALITIES = ['normal', 'premium', 'delicate'] as const;

let rowSeq = 0;
const newRow = (name = '', category = 'custom', price = ''): Row => ({
  key: `row-${++rowSeq}`,
  name,
  category,
  quality: 'normal',
  quantity: 1,
  priceRupees: price,
});

export function NewOrder() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<'cash' | 'upi' | 'card' | 'unpaid'>('cash');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Single source of truth: the catalogue and its prices live on the server.
  const { data: catalogueData } = useApi(() => api.catalogue(), []);
  const catalogue = catalogueData?.items ?? [];

  const updateRow = useCallback((key: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const subtotal = rows.reduce((sum, r) => sum + r.quantity * toPaise(r.priceRupees), 0);
  const total = Math.max(0, subtotal - toPaise(discount));

  async function submit() {
    setError(null);
    if (!name.trim() || phone.trim().length < 10) {
      setError(t('requiredFields'));
      return;
    }
    const items = rows
      .filter((r) => r.name.trim() && r.quantity > 0)
      .map((r) => ({
        name: r.name.trim(),
        category: r.category,
        quality: r.quality,
        quantity: r.quantity,
        unit_price_paise: toPaise(r.priceRupees),
      }));
    if (items.length === 0) {
      setError(t('requiredFields'));
      return;
    }

    setBusy(true);
    try {
      const order = await api.createOrder({
        customer: { name: name.trim(), phone: phone.trim(), address: address.trim(), notes: '' },
        items,
        discount_paise: toPaise(discount),
        paid_paise: toPaise(paid),
        payment_method: method,
        note: '',
      });
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the order');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">Create order</p>
          <h1 className="page-title">{t('newOrder')}</h1>
        </div>
        <div className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-700 ring-1 ring-brand-100">
          {rupees(total)} total
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <section className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-500">{t('customers')}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">Customer</span>
            </div>
            <div>
              <label className="label" htmlFor="cname">{t('customerName')} *</label>
              <input id="cname" className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div>
              <label className="label" htmlFor="cphone">{t('phone')} *</label>
              <input
                id="cphone"
                className="field"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                maxLength={15}
                autoComplete="tel"
              />
              <p className="mt-1 text-xs text-slate-500">{t('customerExists')}</p>
            </div>
            <div>
              <label className="label" htmlFor="caddr">{t('address')}</label>
              <input id="caddr" className="field" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </section>

          <section className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-500">{t('items')}</h2>
              <span className="rounded-full bg-brand-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-700">{rows.length} items</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {catalogue.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setRows((prev) => [...prev, newRow(c.label[lang] ?? c.label.en, c.key, fromPaise(c.price_paise))])}
                  className="rounded-full bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 ring-1 ring-brand-100 transition hover:bg-brand-100"
                >
                  + {c.label[lang] ?? c.label.en} · ₹{fromPaise(c.price_paise)}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.key} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 shadow-sm">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="col-span-2">
                      <label className="label">{t('itemName')}</label>
                      <input
                        className="field"
                        value={row.name}
                        onChange={(e) => updateRow(row.key, { name: e.target.value })}
                        placeholder={t('customItem')}
                      />
                    </div>
                    <div>
                      <label className="label">{t('quantity')}</label>
                      <input
                        className="field"
                        type="number"
                        min={1}
                        max={500}
                        value={row.quantity}
                        onChange={(e) => updateRow(row.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </div>
                    <div>
                      <label className="label">{t('unitPrice')}</label>
                      <input
                        className="field"
                        inputMode="decimal"
                        value={row.priceRupees}
                        onChange={(e) => updateRow(row.key, { priceRupees: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="label">{t('quality')}</label>
                      <select
                        className="field"
                        value={row.quality}
                        onChange={(e) => updateRow(row.key, { quality: e.target.value as Row['quality'] })}
                      >
                        {QUALITIES.map((q) => (
                          <option key={q} value={q}>
                            {t(`quality_${q}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 flex items-end justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-700">
                        {t('lineTotal')}: {rupees(row.quantity * toPaise(row.priceRupees))}
                      </p>
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600 transition hover:text-red-700"
                        onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== row.key) : prev))}
                      >
                        {t('remove')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button type="button" className="btn-ghost w-full" onClick={() => setRows((prev) => [...prev, newRow()])}>
              + {t('addItem')}
            </button>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-500">Payments</h2>
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Ready</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="disc">{t('discount')}</label>
                <input id="disc" className="field" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="paid">{t('paidNow')}</label>
                <input id="paid" className="field" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="method">{t('paymentMethod')}</label>
              <select id="method" className="field" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="cash">{t('cash')}</option>
                <option value="upi">{t('upi')}</option>
                <option value="card">{t('card')}</option>
                <option value="unpaid">{t('unpaid')}</option>
              </select>
            </div>

            <dl className="soft-divider space-y-2 pt-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-600">{t('subtotal')}</dt>
                <dd className="font-medium text-slate-700">{rupees(subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between text-base font-bold text-slate-900">
                <dt>{t('total')}</dt>
                <dd>{rupees(total)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={() => navigate(-1)}>
          {t('cancel')}
        </button>
        <button type="button" className="btn-primary flex-1" onClick={submit} disabled={busy}>
          {busy ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}
