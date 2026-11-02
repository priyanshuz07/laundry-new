import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Order, type OrderStatus } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useI18n } from '../i18n';
import { rupees } from '../lib/money';
import { StatusBadge } from '../components/StatusBadge';

const FILTERS: (OrderStatus | 'all')[] = ['all', 'in_process', 'done', 'ready', 'collected'];

export function Orders() {
  const { t } = useI18n();
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  // Debounce so typing does not fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(id);
  }, [term]);

  useEffect(() => {
    setPage(1);
  }, [status, debounced]);

  const { data, error, loading, reload } = useApi(
    () => api.orders({ status: status === 'all' ? '' : status, q: debounced, page }),
    [status, debounced, page],
  );

  const pages = useMemo(() => (data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1), [data]);

  const metrics = data
    ? [
        { label: t('totalOrders'), value: String(data.total), tone: 'brand' },
        { label: t('openOrders'), value: String(data.items.filter((o) => o.status !== 'collected').length), tone: 'blue' },
        { label: t('balance'), value: rupees(data.items.reduce((sum, o) => sum + Math.max(0, o.balance_paise), 0)), tone: 'amber' },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">Dashboard</p>
          <h1 className="page-title">{t('orders')}</h1>
        </div>
        <Link to="/orders/new" className="btn-primary px-4 py-2.5 text-sm">
          + {t('newOrder')}
        </Link>
      </div>

      {data && (
        <div className="stats-grid">
          {metrics.map((metric) => (
            <div key={metric.label} className="metric-card">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{metric.label}</p>
              <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">{metric.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card space-y-3 p-3">
        <input
          className="field"
          placeholder={t('searchPlaceholder')}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          type="search"
        />

        <div className="no-print -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatus(f)}
              className={`whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition ${
                status === f ? 'bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-lg shadow-brand-600/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f === 'all' ? t('all') : t(`status_${f}`)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={reload} className="btn-ghost px-3 py-1 text-xs">Retry</button>
        </div>
      )}

      {loading && !data && <p className="p-6 text-center text-slate-500">{t('loading')}</p>}

      {data && data.items.length === 0 && !loading && (
        <div className="empty-state">{t('noOrders')}</div>
      )}

      <ul className="space-y-3">
        {data?.items.map((order: Order) => (
          <li key={order.id}>
            <Link to={`/orders/${order.id}`} className="list-card hover:border-brand-200 hover:ring-1 hover:ring-brand-100">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-lg text-brand-700 ring-1 ring-brand-100">
                  🧺
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-brand-700">{order.order_no}</span>
                    <StatusBadge status={order.status} />
                  </div>
                  <p className="truncate text-sm font-semibold text-slate-800">{order.customer_name}</p>
                  <p className="text-xs text-slate-500">
                    {order.items.length} · {order.created_at ? new Date(order.created_at).toLocaleString() : ''}
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base font-black text-slate-900">{rupees(order.total_paise)}</p>
                {order.balance_paise > 0 ? (
                  <p className="text-xs text-red-600">{t('balance')}: {rupees(order.balance_paise)}</p>
                ) : (
                  <p className="text-xs text-emerald-600">Paid</p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {data && pages > 1 && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 shadow-sm">
          <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ←
          </button>
          <span className="text-sm font-medium text-slate-600">
            {page} / {pages}
          </span>
          <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            →
          </button>
        </div>
      )}
    </div>
  );
}
