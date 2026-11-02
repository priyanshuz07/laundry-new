import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type ServiceCategory } from '../lib/api';
import { useApi } from '../lib/useApi';
import { rupees } from '../lib/money';
import { useI18n } from '../i18n';

/** Print-friendly receipt. A4/thermal agnostic: 80mm-safe single column. */
export function Bill() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { data: order, error, loading } = useApi(() => api.order(id), [id]);

  useEffect(() => {
    document.body.classList.add('bg-white');
    return () => document.body.classList.remove('bg-white');
  }, []);

  if (loading && !order) return <p className="p-6 text-center">{t('loading')}</p>;
  if (error) return <p className="p-6 text-center text-red-700">{error}</p>;
  if (!order) return null;

  const serviceLabels: Record<ServiceCategory, string> = {
    dry_cleaning: t('dryCleaning'),
    press: t('pressService'),
    wash: t('washService'),
  };
  const pendingPaise = Math.max(0, order.total_paise - order.paid_paise);
  const delivered = order.status === 'delivered' || order.status === 'collected';

  return (
    <div className="mx-auto max-w-sm bg-white p-4 text-slate-900">
      <div className="no-print mb-4 flex gap-2">
        <button type="button" className="btn-primary flex-1" onClick={() => window.print()}>
          {t('printBill')}
        </button>
        <button type="button" className="btn-ghost" onClick={() => navigate(`/orders/${id}`)}>
          {t('cancel')}
        </button>
      </div>

      <div className="border-b-2 border-dashed border-slate-400 pb-2 text-center">
        <h1 className="text-lg font-bold">{t('appName')}</h1>
        <p className="text-xs text-slate-600">{t('tagline')}</p>
      </div>

      <div className="py-2 text-sm">
        <div className="flex justify-between">
          <span className="font-mono font-semibold">{order.order_no}</span>
          <span>{order.created_at ? new Date(order.created_at).toLocaleDateString() : ''}</span>
        </div>
        <p>{t('customerName')}: {order.customer_name}</p>
        <p>{t('phone')}: {order.customer_phone}</p>
        {order.customer_address && <p className="text-xs">{order.customer_address}</p>}
        {order.service_categories && order.service_categories.length > 0 && (
          <p>{t('serviceCategory')}: {order.service_categories.map((service) => serviceLabels[service]).join(', ')}</p>
        )}
        {order.rack_number !== undefined && <p>{t('rackNumber')}: Rack {order.rack_number}</p>}
        <p>{t('deliveryStatus')}: {delivered ? t('delivered') : order.status === 'ready' ? t('awaitingDelivery') : t('notReadyForDelivery')}</p>
      </div>

      <table className="w-full border-t border-dashed border-slate-400 text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1">{t('itemName')}</th>
            <th className="py-1 text-center">{t('quantity')}</th>
            <th className="py-1 text-right">{t('unitPrice')}</th>
            <th className="py-1 text-right">{t('lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, index) => (
            <tr key={`${item.name}-${index}`} className="border-t border-slate-200">
              <td className="py-1">{item.name}</td>
              <td className="py-1 text-center">{item.quantity}</td>
              <td className="py-1 text-right">{rupees(item.unit_price_paise)}</td>
              <td className="py-1 text-right">{rupees(item.line_total_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-2 space-y-1 border-t-2 border-dashed border-slate-400 pt-2 text-sm">
        <div className="flex justify-between">
          <dt>{t('subtotal')}</dt>
          <dd>{rupees(order.subtotal_paise)}</dd>
        </div>
        {order.discount_paise > 0 && (
          <div className="flex justify-between">
            <dt>{t('discount')}</dt>
            <dd>-{rupees(order.discount_paise)}</dd>
          </div>
        )}
        <div className="flex justify-between text-base font-bold">
          <dt>{t('total')}</dt>
          <dd>{rupees(order.total_paise)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('paidAmount')}</dt>
          <dd>{rupees(order.paid_paise)}</dd>
        </div>
        {pendingPaise > 0 && (
          <div className="flex justify-between font-semibold">
            <dt>{t('pendingPayment')}</dt>
            <dd>{rupees(pendingPaise)}</dd>
          </div>
        )}
      </dl>

      <p className="mt-3 border-t border-dashed border-slate-400 pt-2 text-center text-xs">
        {t('qrHint')}
      </p>
      <p className="text-center text-xs text-slate-500">— {t('detail')} —</p>
    </div>
  );
}
