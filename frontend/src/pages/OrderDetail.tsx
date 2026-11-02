import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, type OrderStatus, type ServiceCategory } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { useI18n } from '../i18n';
import { fromPaise, rupees } from '../lib/money';
import { StatusBadge } from '../components/StatusBadge';

const NEXT: Record<OrderStatus, { status: OrderStatus; labelKey: 'markDone' | 'markReady' }[]> = {
  in_process: [
    { status: 'done', labelKey: 'markDone' },
    { status: 'ready', labelKey: 'markReady' },
  ],
  done: [{ status: 'ready', labelKey: 'markReady' }],
  ready: [],
  collected: [],
  delivered: [],
};

function parsePaymentPaise(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function OrderDetail() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const location = useLocation();
  const { data: order, error, loading, reload } = useApi(() => api.order(id), [id]);
  const [qr, setQr] = useState<{ data_url: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [paidInput, setPaidInput] = useState('');
  const [showPendingPayment, setShowPendingPayment] = useState(false);
  const routeState = location.state as {
    returnTo?: { pathname?: string; search?: string; state?: unknown };
  } | null;
  const requestedReturn = routeState?.returnTo;
  const returnPath =
    requestedReturn?.pathname === '/reports' && isAdmin ? '/reports' : '/orders';
  const returnTo = {
    pathname: returnPath,
    search: requestedReturn?.pathname === returnPath && requestedReturn.search?.startsWith('?')
      ? requestedReturn.search
      : '',
    state: requestedReturn?.pathname === returnPath ? requestedReturn.state : undefined,
  };

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
    const paymentPaise = parsePaymentPaise(paidInput);
    if (paymentPaise === null) {
      setActionError(t('paymentPositiveError'));
      return;
    }
    if (order && paymentPaise > Math.max(0, order.total_paise - order.paid_paise)) {
      setActionError(t('paymentExceedsBalanceError'));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.setPayment(id, paymentPaise);
      setPaidInput('');
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the payment');
    } finally {
      setBusy(false);
    }
  }

  async function deliverOrder() {
    setBusy(true);
    setActionError(null);
    try {
      await api.deliverOrder(id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not deliver the order');
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

  const serviceLabels: Record<ServiceCategory, string> = {
    dry_cleaning: t('dryCleaning'),
    press: t('pressService'),
    wash: t('washService'),
  };
  const pendingPaise = Math.max(0, order.total_paise - order.paid_paise);
  const isDelivered = order.status === 'delivered' || order.status === 'collected';
  const canDeliver = order.status === 'ready' && pendingPaise === 0 && order.paid_paise === order.total_paise;
  const parsedPayment = parsePaymentPaise(paidInput);
  const paymentInputError = paidInput
    ? parsedPayment === null
      ? t('paymentPositiveError')
      : parsedPayment > pendingPaise
        ? t('paymentExceedsBalanceError')
        : ''
    : '';

  return (
    <div className="space-y-4">
      <Link
        to={returnTo}
        state={requestedReturn?.pathname === returnPath ? requestedReturn.state : undefined}
        className="text-sm text-brand-700"
      >
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
        {order.service_categories && order.service_categories.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('serviceCategory')}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {order.service_categories.map((service) => (
                <span key={service} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                  {serviceLabels[service]}
                </span>
              ))}
            </div>
          </div>
        )}
        {order.rack_number !== undefined && (
          <p className="mt-2 text-sm text-slate-600">
            <span aria-hidden="true">🗄️ </span>{t('rackNumber')}: Rack {order.rack_number}
          </p>
        )}
        <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2">
          <p>
            <span className="text-slate-500">{t('deliveryStatus')}: </span>
            <span className="font-medium">{isDelivered ? t('delivered') : order.status === 'ready' ? t('awaitingDelivery') : t('notReadyForDelivery')}</span>
          </p>
          <p>
            <span className="text-slate-500">{t('paymentStatus')}: </span>
            <span className={`font-medium ${pendingPaise > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {pendingPaise > 0 ? t('pendingPayment') : t('paidInFull')}
            </span>
          </p>
        </div>
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
            <dt>{t('pendingPayment')}</dt>
            <dd>{rupees(pendingPaise)}</dd>
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
        <button
          type="button"
          className="btn-ghost"
          aria-expanded={showPendingPayment}
          onClick={() => setShowPendingPayment((visible) => !visible)}
        >
          {t('pendingPayment')}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !canDeliver}
          onClick={deliverOrder}
        >
          {t('deliverToCustomer')}
        </button>
        <button type="button" className="btn-ghost" onClick={showQr}>
          {t('showQr')}
        </button>
        <Link to={`/orders/${order.id}/bill`} className="btn-ghost">
          {t('printBill')}
        </Link>
      </div>

      {showPendingPayment && (
        <div className="card space-y-2 text-sm" aria-live="polite">
          <div className="flex justify-between">
            <span className="text-slate-600">{t('totalAmount')}</span>
            <span className="font-medium">{rupees(order.total_paise)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">{t('paidAmount')}</span>
            <span className="font-medium">{rupees(order.paid_paise)}</span>
          </div>
          <div className="flex justify-between font-semibold text-red-600">
            <span>{t('pendingPayment')}</span>
            <span>{rupees(pendingPaise)}</span>
          </div>
        </div>
      )}

      {pendingPaise > 0 && !isDelivered && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('completePaymentBeforeDelivery')}</p>
      )}
      {order.status !== 'ready' && !isDelivered && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{t('readyBeforeDelivery')}</p>
      )}

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

      {pendingPaise > 0 && !isDelivered && (
        <div className="card space-y-2">
          <label className="label" htmlFor="paidnow">{t('paidNow')}</label>
          <div className="flex gap-2">
            <input
              id="paidnow"
              className="field"
              inputMode="decimal"
              placeholder={fromPaise(pendingPaise)}
              value={paidInput}
              onChange={(e) => setPaidInput(e.target.value)}
            />
            <button type="button" className="btn-primary px-4" onClick={savePayment} disabled={busy || !paidInput || Boolean(paymentInputError)}>
              {t('savePayment')}
            </button>
          </div>
          {paymentInputError && <p className="text-xs font-medium text-red-600">{paymentInputError}</p>}
        </div>
      )}

      <p className="text-center text-xs text-slate-400">
        {t('createdBy')}: {order.created_by_name || '-'}
      </p>
    </div>
  );
}
