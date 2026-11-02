import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type OrderStatus } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useI18n } from '../i18n';
import { fromPaise, rupees, toPaise } from '../lib/money';
import { StatusBadge } from '../components/StatusBadge';

const NEXT: Record<OrderStatus, { status: OrderStatus; labelKey: 'markDone' | 'markReady' | 'markCollected' }[]> = {
  in_process: [
    { status: 'done', labelKey: 'markDone' },
    { status: 'ready', labelKey: 'markReady' },
  ],
  done: [{ status: 'ready', labelKey: 'markReady' }],
  ready: [{ status: 'collected', labelKey: 'markCollected' }],
  collected: [],
};

export function OrderDetail() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { data: order, error, loading, reload } = useApi(() => api.order(id), [id]);
  const [qr, setQr] = useState<{ data_url: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [paidInput, setPaidInput] = useState('');

  async function changeStatus(status: OrderStatus) {
    setBusy(true);
    setActionError(null);
    try {
      await api.setStatus(id, status);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the order');
    } finally {
      setBusy(false);
    }
  }

  async function savePayment() {
    setBusy(true);
    setActionError(null);
    try {
      await api.setPayment(id, toPaise(paidInput));
      setPaidInput('');
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the payment');
    } finally {
      setBusy(false);
    }
  }

  async function showQr() {
    setActionError(null);
    try {
      setQr(await api.qr(id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not load the QR code');
    }
  }

  if (loading && !order) return <p className="p-6 text-center text-slate-500">{t('loading')}</p>;
  if (error) return <div className="card text-sm text-red-700">{error}</div>;
  if (!order) return null;

  return (
    <div className="space-y-4">
      <Link to="/orders" className="text-sm text-brand-700">
        ← {t('back')}
      </Link>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-bold text-brand-700">{order.order_no}</span>
          <StatusBadge status={order.status} />
          <span className="ml-auto text-xs text-slate-500">
            {order.created_at ? new Date(order.created_at).toLocaleString() : ''}
          </span>
        </div>
        <p className="mt-2 font-medium">{order.customer_name}</p>
        <p className="text-sm text-slate-600">{order.customer_phone}</p>
        {order.customer_address && <p className="text-sm text-slate-500">{order.customer_address}</p>}
      </div>

      <div className="card">
        <h2 className="mb-2 text-sm font-semibold text-slate-500">{t('items')}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-400">
              <th className="pb-2">{t('itemName')}</th>
              <th className="pb-2 text-center">{t('quantity')}</th>
              <th className="pb-2 text-right">{t('lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, index) => (
              <tr key={`${item.name}-${index}`} className="border-t border-slate-100">
                <td className="py-2">
                  {item.name}
                  <span className="ml-1 text-xs text-slate-400">{t(`quality_${item.quality}`)}</span>
                </td>
                <td className="py-2 text-center">{item.quantity}</td>
                <td className="py-2 text-right">{rupees(item.line_total_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-3 space-y-1 border-t border-dashed border-slate-300 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">{t('subtotal')}</dt>
            <dd>{rupees(order.subtotal_paise)}</dd>
          </div>
          {order.discount_paise > 0 && (
            <div className="flex justify-between text-slate-600">
              <dt>{t('discount')}</dt>
              <dd>-{rupees(order.discount_paise)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <dt>{t('total')}</dt>
            <dd>{rupees(order.total_paise)}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>Paid</dt>
            <dd>{rupees(order.paid_paise)}</dd>
          </div>
          <div className="flex justify-between font-semibold text-red-600">
            <dt>{t('balance')}</dt>
            <dd>{rupees(order.balance_paise)}</dd>
          </div>
        </dl>
      </div>

      {actionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}

      <div className="no-print grid grid-cols-2 gap-2">
        {NEXT[order.status].map((action) => (
          <button
            key={action.status}
            type="button"
            className="btn-primary col-span-2"
            disabled={busy}
            onClick={() => changeStatus(action.status)}
          >
            {t(action.labelKey)}
          </button>
        ))}
        <button type="button" className="btn-ghost" onClick={showQr}>
          {t('showQr')}
        </button>
        <Link to={`/orders/${order.id}/bill`} className="btn-ghost">
          {t('printBill')}
        </Link>
      </div>

      {order.status === 'ready' && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{t('whatsappOnReady')}</p>
      )}

      {qr && (
        <div className="card text-center">
          <img src={qr.data_url} alt={`QR ${order.order_no}`} className="mx-auto h-56 w-56" />
          <p className="mt-2 text-sm font-medium">{order.order_no}</p>
          <p className="break-all text-xs text-slate-500">{qr.url}</p>
          <p className="mt-2 text-xs text-slate-500">{t('qrHint')}</p>
          <a href={qr.data_url} download={`${order.order_no}.png`} className="btn-ghost mt-3 w-full">
            Download PNG
          </a>
        </div>
      )}

      {order.balance_paise > 0 && (
        <div className="card space-y-2">
          <label className="label" htmlFor="paidnow">{t('paidNow')}</label>
          <div className="flex gap-2">
            <input
              id="paidnow"
              className="field"
              inputMode="decimal"
              placeholder={fromPaise(order.balance_paise)}
              value={paidInput}
              onChange={(e) => setPaidInput(e.target.value)}
            />
            <button type="button" className="btn-primary px-4" onClick={savePayment} disabled={busy || !paidInput}>
              {t('savePayment')}
            </button>
          </div>
        </div>
      )}

      <p className="text-center text-xs text-slate-400">
        {t('createdBy')}: {order.created_by_name || '-'}
      </p>
    </div>
  );
}
