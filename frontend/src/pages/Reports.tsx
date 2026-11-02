import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, type Order, type OrderStatus } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useI18n } from '../i18n';
import { rupees } from '../lib/money';
import { StatusBadge } from '../components/StatusBadge';

const RANGES = [
  { days: 7, key: 'thisWeek' as const },
  { days: 30, key: 'thisMonth' as const },
];

const PAYMENT_METHODS = ['cash', 'upi', 'card'] as const;
const ORDER_STATUSES: OrderStatus[] = ['in_process', 'done', 'ready', 'collected', 'delivered'];

function parsePaymentPaise(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function localDateKey(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function Reports() {
  const { t } = useI18n();
  const location = useLocation();
  const restored = (
    location.state as {
      reportsState?: {
        granularity?: 'day' | 'week' | 'month';
        days?: number;
        pendingOpen?: boolean;
        search?: string;
        dateFrom?: string;
        dateTo?: string;
        statusFilter?: OrderStatus | 'all';
        sort?: 'amount' | 'oldest';
      };
    } | null
  )?.reportsState;
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>(restored?.granularity ?? 'day');
  const [days, setDays] = useState(restored?.days ?? 7);
  const [pendingOpen, setPendingOpen] = useState(restored?.pendingOpen ?? false);
  const [search, setSearch] = useState(restored?.search ?? '');
  const [dateFrom, setDateFrom] = useState(restored?.dateFrom ?? '');
  const [dateTo, setDateTo] = useState(restored?.dateTo ?? '');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>(restored?.statusFilter ?? 'all');
  const [sort, setSort] = useState<'amount' | 'oldest'>(restored?.sort ?? 'amount');
  const [collectOrder, setCollectOrder] = useState<Order | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>('cash');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const detailReturnState = {
    reportsState: { granularity, days, pendingOpen, search, dateFrom, dateTo, statusFilter, sort },
  };

  const { data: dashboard } = useApi(() => api.dashboard(), []);
  const { data, error, loading } = useApi(() => api.report(granularity, days), [granularity, days]);
  const {
    data: pendingOrders,
    error: pendingError,
    loading: pendingLoading,
    reload: reloadPending,
  } = useApi(() => api.pendingPayments(), []);

  const max = Math.max(1, ...(data?.buckets.map((b) => b.revenue_paise) ?? [1]));
  const pendingTotal = (pendingOrders ?? []).reduce(
    (sum, order) => sum + Math.max(0, order.total_paise - order.paid_paise),
    0,
  );
  const normalizedSearch = search.trim().toLowerCase();
  const filteredPending = useMemo(() => {
    const filtered = (pendingOrders ?? []).filter((order) => {
      const orderDate = localDateKey(order.created_at);
      const matchesSearch = !normalizedSearch || [
        order.order_no,
        order.customer_name,
        order.customer_phone,
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
      return (
        matchesSearch &&
        (!dateFrom || orderDate >= dateFrom) &&
        (!dateTo || orderDate <= dateTo) &&
        (statusFilter === 'all' || order.status === statusFilter)
      );
    });
    return filtered.sort((a, b) =>
      sort === 'amount'
        ? (b.total_paise - b.paid_paise) - (a.total_paise - a.paid_paise)
        : (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
  }, [pendingOrders, normalizedSearch, dateFrom, dateTo, statusFilter, sort]);

  async function collectPayment() {
    if (!collectOrder) return;
    const amount = parsePaymentPaise(paymentAmount);
    const outstanding = Math.max(0, collectOrder.total_paise - collectOrder.paid_paise);
    if (amount === null) {
      setPaymentError(t('paymentPositiveError'));
      return;
    }

    if (amount > outstanding) {
      setPaymentError(t('paymentExceedsBalanceError'));
      return;
    }

    setSavingPayment(true);
    setPaymentError(null);
    try {
      await api.setPayment(collectOrder.id, amount, paymentMethod);
      setCollectOrder(null);
      setPaymentAmount('');
      reloadPending();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Could not record payment');
    } finally {
      setSavingPayment(false);
    }
  }

  function openCollectPayment(order: Order) {
    setCollectOrder(order);
    setPaymentAmount('');
    setPaymentError(null);
    setPaymentMethod(PAYMENT_METHODS.find((method) => method === order.payment_method) ?? 'cash');
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">Performance</p>
          <h1 className="page-title">{t('reports')}</h1>
        </div>
        <div className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-700 ring-1 ring-brand-100">
          Live overview
        </div>
      </div>

      {dashboard && (
        <div className="stats-grid">
          <div className="metric-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t('todayRevenue')}</p>
            <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">{rupees(dashboard.today.revenue_paise)}</p>
            <p className="mt-1 text-xs text-slate-500">{dashboard.today.orders} {t('totalOrders')}</p>
          </div>
          <div className="metric-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t('openOrders')}</p>
            <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">
              {(dashboard.open_orders.in_process ?? 0) + (dashboard.open_orders.done ?? 0) + (dashboard.open_orders.ready ?? 0)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t('status_ready')}: {dashboard.open_orders.ready ?? 0}
            </p>
          </div>
          <div className="metric-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t('revenue')}</p>
            <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">{rupees(dashboard.today.revenue_paise)}</p>
            <p className="mt-1 text-xs text-slate-500">This period</p>
          </div>
          <div className="metric-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Collected</p>
            <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">{rupees(dashboard.today.revenue_paise)}</p>
            <p className="mt-1 text-xs text-slate-500">Cash flow</p>
          </div>
        </div>
      )}

      <button
        type="button"
        aria-expanded={pendingOpen}
        onClick={() => setPendingOpen((open) => !open)}
        className="metric-card w-full text-left transition hover:border-brand-200 hover:ring-1 hover:ring-brand-100"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t('pendingPayment')}</p>
            <p className="mt-2 text-xl font-black text-red-700">{rupees(pendingTotal)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">{t('pendingOrders')}</p>
            <p className="text-2xl font-black text-slate-900">{pendingOrders?.length ?? 0}</p>
          </div>
          <span className="rounded-full bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700">
            {pendingOpen ? t('hidePendingPayments') : t('viewPendingPayments')}
          </span>
        </div>
      </button>

      {pendingOpen && (
        <section className="card space-y-4" aria-labelledby="pending-payments-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t('pendingPayments')}</p>
              <h2 id="pending-payments-heading" className="mt-1 text-lg font-bold text-slate-900">
                {t('pendingOrders')}: {pendingOrders?.length ?? 0} · {t('totalOutstanding')}: {rupees(pendingTotal)}
              </h2>
            </div>
            <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={reloadPending}>
              {t('refresh')}
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <input
              className="field sm:col-span-2 xl:col-span-2"
              type="search"
              placeholder={t('searchPendingPayments')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <input
              className="field"
              type="date"
              aria-label={t('dateFrom')}
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <input
              className="field"
              type="date"
              aria-label={t('dateTo')}
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
            <select className="field" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as OrderStatus | 'all')}>
              <option value="all">{t('allStatuses')}</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>{t(`status_${status}`)}</option>
              ))}
            </select>
            <select className="field sm:col-span-2 xl:col-span-1" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="amount">{t('sortHighestPending')}</option>
              <option value="oldest">{t('sortOldest')}</option>
            </select>
          </div>

          {pendingError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{pendingError}</p>}
          {pendingLoading && !pendingOrders && <p className="py-6 text-center text-slate-500">{t('loading')}</p>}
          {!pendingLoading && filteredPending.length === 0 && (
            <div className="empty-state">{t(pendingOrders?.length ? 'noMatchingPendingPayments' : 'noPendingPayments')}</div>
          )}

          {filteredPending.length > 0 && (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[1050px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="px-2 py-3">{t('orderNo')}</th>
                      <th className="px-2 py-3">{t('customerName')}</th>
                      <th className="px-2 py-3">{t('phone')}</th>
                      <th className="px-2 py-3">{t('orderDate')}</th>
                      <th className="px-2 py-3 text-right">{t('totalAmount')}</th>
                      <th className="px-2 py-3 text-right">{t('paidAmount')}</th>
                      <th className="px-2 py-3 text-right">{t('pendingAmount')}</th>
                      <th className="px-2 py-3">{t('orderStatus')}</th>
                      <th className="px-2 py-3">{t('paymentMethod')}</th>
                      <th className="px-2 py-3">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPending.map((order) => {
                      const pending = Math.max(0, order.total_paise - order.paid_paise);
                      return (
                        <tr key={order.id} className="border-b border-slate-100">
                          <td className="px-2 py-3 font-mono font-semibold text-brand-700">{order.order_no}</td>
                          <td className="px-2 py-3">{order.customer_name}</td>
                          <td className="px-2 py-3">{order.customer_phone}</td>
                          <td className="px-2 py-3">{order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}</td>
                          <td className="px-2 py-3 text-right">{rupees(order.total_paise)}</td>
                          <td className="px-2 py-3 text-right">{rupees(order.paid_paise)}</td>
                          <td className="px-2 py-3 text-right font-bold text-red-700">{rupees(pending)}</td>
                          <td className="px-2 py-3"><StatusBadge status={order.status} /></td>
                          <td className="px-2 py-3">{t(order.payment_method === 'upi' ? 'upi' : order.payment_method === 'card' ? 'card' : order.payment_method === 'unpaid' ? 'unpaid' : 'cash')}</td>
                          <td className="px-2 py-3">
                            <div className="flex gap-2">
                              <Link
                                to={`/orders/${order.id}`}
                                state={{
                                  returnTo: {
                                    pathname: location.pathname,
                                    search: location.search,
                                    state: detailReturnState,
                                  },
                                }}
                                className="btn-ghost px-2 py-1 text-xs"
                              >
                                {t('viewOrder')}
                              </Link>
                              <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={() => openCollectPayment(order)}>
                                {t('collectPayment')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <ul className="space-y-3 md:hidden">
                {filteredPending.map((order) => {
                  const pending = Math.max(0, order.total_paise - order.paid_paise);
                  return (
                    <li key={order.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono text-sm font-bold text-brand-700">{order.order_no}</p>
                          <p className="font-semibold text-slate-800">{order.customer_name}</p>
                          <p className="text-xs text-slate-500">{order.customer_phone}</p>
                        </div>
                        <StatusBadge status={order.status} />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">{t('orderDate')}: {order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}</p>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div><dt className="text-xs text-slate-500">{t('totalAmount')}</dt><dd>{rupees(order.total_paise)}</dd></div>
                        <div><dt className="text-xs text-slate-500">{t('paidAmount')}</dt><dd>{rupees(order.paid_paise)}</dd></div>
                        <div><dt className="text-xs text-slate-500">{t('pendingAmount')}</dt><dd className="font-bold text-red-700">{rupees(pending)}</dd></div>
                        <div><dt className="text-xs text-slate-500">{t('paymentMethod')}</dt><dd>{t(order.payment_method === 'upi' ? 'upi' : order.payment_method === 'card' ? 'card' : order.payment_method === 'unpaid' ? 'unpaid' : 'cash')}</dd></div>
                      </dl>
                      <div className="mt-3 flex gap-2">
                        <Link
                          to={`/orders/${order.id}`}
                          state={{
                            returnTo: {
                              pathname: location.pathname,
                              search: location.search,
                              state: detailReturnState,
                            },
                          }}
                          className="btn-ghost flex-1 text-center"
                        >
                          {t('viewOrder')}
                        </Link>
                        <button type="button" className="btn-primary flex-1" onClick={() => openCollectPayment(order)}>
                          {t('collectPayment')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {collectOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !savingPayment) setCollectOrder(null);
        }}>
          <section className="card w-full max-w-lg space-y-4 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="collect-payment-heading">
            <div>
              <h2 id="collect-payment-heading" className="text-lg font-bold text-slate-900">{t('collectPayment')}</h2>
              <p className="mt-1 font-mono text-sm text-brand-700">{collectOrder.order_no} · {collectOrder.customer_name}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
              <div><dt className="text-slate-500">{t('totalAmount')}</dt><dd className="font-semibold">{rupees(collectOrder.total_paise)}</dd></div>
              <div><dt className="text-slate-500">{t('paidAmount')}</dt><dd className="font-semibold">{rupees(collectOrder.paid_paise)}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">{t('pendingAmount')}</dt><dd className="font-bold text-red-700">{rupees(Math.max(0, collectOrder.total_paise - collectOrder.paid_paise))}</dd></div>
            </dl>
            <div>
              <label className="label" htmlFor="reportPaymentAmount">{t('additionalPaymentAmount')}</label>
              <input id="reportPaymentAmount" className="field" inputMode="decimal" value={paymentAmount} onChange={(event) => { setPaymentAmount(event.target.value); setPaymentError(null); }} />
            </div>
            <div>
              <label className="label" htmlFor="reportPaymentMethod">{t('paymentMethod')}</label>
              <select id="reportPaymentMethod" className="field" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as (typeof PAYMENT_METHODS)[number])}>
                {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{t(method)}</option>)}
              </select>
            </div>
            {paymentError && <p className="text-sm font-medium text-red-600">{paymentError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" disabled={savingPayment} onClick={() => setCollectOrder(null)}>{t('cancel')}</button>
              <button type="button" className="btn-primary" disabled={savingPayment || parsePaymentPaise(paymentAmount) === null || (parsePaymentPaise(paymentAmount) ?? 0) > collectOrder.total_paise - collectOrder.paid_paise} onClick={collectPayment}>
                {savingPayment ? t('saving') : t('savePayment')}
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['day', 'week', 'month'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                granularity === g ? 'bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-lg shadow-brand-600/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t(g === 'day' ? 'daily' : g === 'week' ? 'weekly' : 'monthly')}
            </button>
          ))}
          <select
            className="ml-auto rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-700 outline-none focus:border-brand-500"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {t(r.key)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="card text-sm text-red-700">{error}</div>}
      {loading && !data && <p className="p-6 text-center text-slate-500">{t('loading')}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{t('revenue')}</p>
              <p className="mt-2 text-xl font-black text-slate-900">{rupees(data.totals.revenue_paise)}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{t('collected')}</p>
              <p className="mt-2 text-xl font-black text-emerald-700">{rupees(data.totals.collected_paise)}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{t('orderCount')}</p>
              <p className="mt-2 text-xl font-black text-slate-900">{data.totals.order_count}</p>
            </div>
          </div>

          {data.buckets.length === 0 ? (
            <div className="empty-state">{t('noOrders')}</div>
          ) : (
            <div className="card space-y-3 p-4">
              {data.buckets.map((b) => (
                <div key={b.period}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-slate-600">{new Date(b.period).toLocaleDateString()}</span>
                    <span className="font-bold text-slate-800">{rupees(b.revenue_paise)}</span>
                  </div>
                  <div className="mt-2 h-2.5 rounded-full bg-slate-100">
                    <div
                      className="h-2.5 rounded-full bg-gradient-to-r from-brand-500 to-brand-600"
                      style={{ width: `${Math.round((b.revenue_paise / max) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {b.order_count} {t('orderCount')} · {t('collected')} {rupees(b.collected_paise)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
