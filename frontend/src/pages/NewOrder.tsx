import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type ServiceCategory } from '../lib/api';
import { fromPaise, rupees, toPaise } from '../lib/money';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';

interface Row {
  key: string;
  name: string;
  category: string;
  quality: 'normal' | 'premium' | 'delicate';
  quantity: string;
  priceRupees: string;
}

const QUALITIES = ['normal', 'premium', 'delicate'] as const;
const SERVICE_OPTIONS: { value: ServiceCategory; labelKey: 'dryCleaning' | 'pressService' | 'washService'; icon: string }[] = [
  { value: 'dry_cleaning', labelKey: 'dryCleaning', icon: '🧥' },
  { value: 'press', labelKey: 'pressService', icon: '♨️' },
  { value: 'wash', labelKey: 'washService', icon: '🫧' },
];
const RACK_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);

let rowSeq = 0;
const newRow = (name = '', category = 'custom', price = ''): Row => ({
  key: `row-${++rowSeq}`,
  name,
  category,
  quality: 'normal',
  quantity: '1',
  priceRupees: price,
});

function parseQuantity(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

function parsePaidPaise(value: string): number | null {
  if (value === '') return 0;
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(value);
  if (!match || !/\d/.test(value)) return null;
  const whole = Number(match[1] || 0);
  const fraction = Number((match[2] || '').padEnd(2, '0'));
  const paise = whole * 100 + fraction;
  return Number.isSafeInteger(paise) ? paise : null;
}

export function NewOrder() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [address, setAddress] = useState('');
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>([]);
  const [rackNumber, setRackNumber] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [paidTouched, setPaidTouched] = useState(false);
  const [method, setMethod] = useState<'cash' | 'upi' | 'card' | 'unpaid'>('cash');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Single source of truth: the catalogue and its prices live on the server.
  const { data: catalogueData } = useApi(() => api.catalogue(), []);
  const catalogue = catalogueData?.items ?? [];

  const subtotal = rows.reduce((sum, r) => sum + (parseQuantity(r.quantity) ?? 0) * toPaise(r.priceRupees), 0);
  const total = Math.max(0, subtotal - toPaise(discount));
  const phoneError = (phoneTouched || phone.length > 0) && !/^\d{10}$/.test(phone) ? t('phoneDigitsError') : '';
  const parsedPaid = parsePaidPaise(paid);
  const paidError = paidTouched
    ? parsedPaid === null
      ? t('paidInvalidError')
      : parsedPaid > total
        ? t('paidExceedsTotalError')
        : ''
    : '';

  function addCatalogueItem(item: (typeof catalogue)[number]) {
    setRows((previous) => {
      if (item.key !== 'custom') {
        const existing = previous.find((row) => row.category === item.key);
        if (existing) {
          return previous.map((row) =>
            row.key === existing.key
              ? { ...row, quantity: String((parseQuantity(row.quantity) ?? 0) + 1) }
              : row,
          );
        }
      }

      return [...previous, newRow(item.label[lang] ?? item.label.en, item.key, fromPaise(item.price_paise))];
    });
  }

  function removeRow(key: string) {
    setRows((previous) => {
      const row = previous.find((item) => item.key === key);
      const quantity = row ? parseQuantity(row.quantity) : null;
      if (row && quantity !== null && quantity > 1) {
        return previous.map((item) => (item.key === key ? { ...item, quantity: String(quantity - 1) } : item));
      }
      return previous.filter((item) => item.key !== key);
    });
  }

  function toggleServiceCategory(category: ServiceCategory) {
    setServiceCategories((previous) =>
      previous.includes(category) ? previous.filter((item) => item !== category) : [...previous, category],
    );
  }

  async function submit() {
    setError(null);
    setPhoneTouched(true);
    setPaidTouched(true);
    if (!name.trim()) {
      setError(t('requiredFields'));
      return;
    }
    if (!/^\d{10}$/.test(phone)) return;
    if (parsedPaid === null || parsedPaid > total) return;
    const namedRows = rows.filter((row) => row.name.trim());
    if (namedRows.some((row) => parseQuantity(row.quantity) === null)) {
      setError(t('requiredFields'));
      return;
    }
    const items = namedRows.map((r) => ({
      name: r.name.trim(),
      category: r.category,
      quality: r.quality,
      quantity: Number(r.quantity),
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
        service_categories: serviceCategories,
        rack_number: rackNumber ? Number(rackNumber) : undefined,
        discount_paise: toPaise(discount),
        paid_paise: parsedPaid,
        payment_method: method,
        note: '',
      });
      navigate(`/orders/${order.id}`, {
        replace: true,
        state: {
          returnTo: {
            pathname: '/orders',
            state: location.state,
          },
        },
      });
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
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text');
                  const input = e.currentTarget;
                  const start = input.selectionStart ?? phone.length;
                  const end = input.selectionEnd ?? phone.length;
                  const nextPhone = phone.slice(0, start) + pasted + phone.slice(end);
                  if (!/^\d+$/.test(pasted) || nextPhone.length > 10) {
                    e.preventDefault();
                    setPhoneTouched(true);
                  }
                }}
                onBlur={() => setPhoneTouched(true)}
                maxLength={10}
                autoComplete="tel"
                aria-invalid={Boolean(phoneError)}
              />
              <p className="mt-1 text-xs text-slate-500">{t('customerExists')}</p>
              {phoneError && <p className="mt-1 text-xs font-medium text-red-600">{phoneError}</p>}
            </div>
            <div>
              <label className="label" htmlFor="caddr">{t('address')}</label>
              <input id="caddr" className="field" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </section>

          <section className="card space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-500">{t('serviceCategory')}</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {SERVICE_OPTIONS.map((service) => {
                const selected = serviceCategories.includes(service.value);
                return (
                  <button
                    key={service.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleServiceCategory(service.value)}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-3 text-left text-sm font-semibold transition ${
                      selected
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:bg-brand-50'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-lg" aria-hidden="true">{service.icon}</span>
                      {t(service.labelKey)}
                    </span>
                    {selected && <span aria-hidden="true" className="text-emerald-700">✓</span>}
                  </button>
                );
              })}
            </div>
            <div>
              <label className="label" htmlFor="rackNumber">
                <span aria-hidden="true" className="mr-1">🗄️</span>
                {t('rackNumber')}
              </label>
              <select
                id="rackNumber"
                className="field"
                value={rackNumber}
                onChange={(e) => setRackNumber(e.target.value)}
              >
                <option value="">{t('selectRackNumber')}</option>
                {RACK_OPTIONS.map((rack) => (
                  <option key={rack} value={rack}>{`Rack ${rack}`}</option>
                ))}
              </select>
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
                  onClick={() => addCatalogueItem(c)}
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
                        readOnly
                        placeholder={t('customItem')}
                      />
                    </div>
                    <div>
                      <label className="label">{t('quantity')}</label>
                      <input
                        className="field"
                        type="text"
                        inputMode="numeric"
                        value={row.quantity}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (/^\d*$/.test(value) && (value === '' || Number.isSafeInteger(Number(value)))) {
                            setRows((previous) =>
                              previous.map((item) => (item.key === row.key ? { ...item, quantity: value } : item)),
                            );
                          }
                        }}
                        onBlur={() =>
                          setRows((previous) =>
                            previous.map((item) =>
                              item.key === row.key && parseQuantity(item.quantity) === null
                                ? { ...item, quantity: '1' }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="label">{t('unitPrice')}</label>
                      <input
                        className="field"
                        inputMode="decimal"
                        value={row.priceRupees}
                        onChange={(e) =>
                          setRows((previous) =>
                            previous.map((item) =>
                              item.key === row.key ? { ...item, priceRupees: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="label">{t('quality')}</label>
                      <select
                        className="field"
                        value={row.quality}
                        onChange={(e) =>
                          setRows((previous) =>
                            previous.map((item) =>
                              item.key === row.key
                                ? { ...item, quality: e.target.value as Row['quality'] }
                                : item,
                            ),
                          )
                        }
                      >
                        {QUALITIES.map((quality) => (
                          <option key={quality} value={quality}>
                            {t(`quality_${quality}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 flex items-end justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-700">
                        {t('lineTotal')}: {rupees((parseQuantity(row.quantity) ?? 0) * toPaise(row.priceRupees))}
                      </p>
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600 transition hover:text-red-700"
                        onClick={() => removeRow(row.key)}
                      >
                        {t('remove')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button type="button" className="btn-ghost w-full" onClick={() => setRows((previous) => [...previous, newRow()])}>
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
                <input
                  id="paid"
                  className="field"
                  inputMode="decimal"
                  value={paid}
                  onChange={(e) => {
                    setPaid(e.target.value);
                    setPaidTouched(true);
                  }}
                  onBlur={() => setPaidTouched(true)}
                  aria-invalid={Boolean(paidError)}
                />
                {paidError && <p className="mt-1 text-xs font-medium text-red-600">{paidError}</p>}
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
        <button
          type="button"
          className="btn-ghost flex-1"
          disabled={busy}
          onClick={() => navigate('/orders', { replace: true, state: location.state })}
        >
          {t('cancel')}
        </button>
        <button type="button" className="btn-primary flex-1" onClick={submit} disabled={busy}>
          {busy ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}
