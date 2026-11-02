import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useI18n } from '../i18n';
import { StatusBadge } from '../components/StatusBadge';
import { LanguageSelect } from '../components/LanguageSelect';

/** Opened by a customer scanning the order QR. No login, no private data. */
export function PublicOrder() {
  const { token = '' } = useParams();
  const { t } = useI18n();
  const { data, error, loading } = useApi(() => api.publicOrder(token), [token]);

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-lg text-white">🧺</span>
            <div>
              <p className="text-sm font-bold leading-tight">{t('appName')}</p>
              <p className="text-xs text-slate-500">{t('tagline')}</p>
            </div>
          </div>
          <LanguageSelect />
        </div>

        {loading && <div className="card py-10 text-center text-slate-500">{t('loading')}</div>}
        {error && <div className="card py-10 text-center text-red-700">{error}</div>}

        {data && (
          <div className="card space-y-3">
            <div className="text-center">
              <p className="text-xs uppercase tracking-wide text-slate-400">{t('orderNo')}</p>
              <p className="font-mono text-2xl font-bold text-brand-700">{data.order_no}</p>
              <div className="mt-2 flex justify-center">
                <StatusBadge status={data.status} />
              </div>
            </div>

            <div className="border-t border-dashed border-slate-300 pt-3 text-center">
              <p className="text-xs uppercase text-slate-400">{t('customerName')}</p>
              <p className="text-lg font-semibold">{data.customer_name}</p>
            </div>

            <div className="border-t border-dashed border-slate-300 pt-3">
              <p className="mb-2 text-xs uppercase text-slate-400">
                {t('items')} · {data.total_quantity}
              </p>
              <ul className="space-y-1">
                {data.items.map((item, index) => (
                  <li key={`${item.name}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-sm font-medium">{item.name}</span>
                    <span className="text-sm text-slate-600">× {item.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
