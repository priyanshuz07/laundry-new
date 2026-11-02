import { useState } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useI18n } from '../i18n';
import { rupees } from '../lib/money';

const RANGES = [
  { days: 7, key: 'thisWeek' as const },
  { days: 30, key: 'thisMonth' as const },
];

export function Reports() {
  const { t } = useI18n();
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [days, setDays] = useState(7);

  const { data: dashboard } = useApi(() => api.dashboard(), []);
  const { data, error, loading } = useApi(() => api.report(granularity, days), [granularity, days]);

  const max = Math.max(1, ...(data?.buckets.map((b) => b.revenue_paise) ?? [1]));

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
