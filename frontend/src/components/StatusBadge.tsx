import type { OrderStatus } from '../lib/api';
import { useI18n } from '../i18n';

const STYLES: Record<OrderStatus, string> = {
  in_process: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
  done: 'bg-sky-100 text-sky-800 ring-1 ring-sky-200',
  ready: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
  collected: 'bg-slate-200 text-slate-700 ring-1 ring-slate-300',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  return <span className={`pill ${STYLES[status]}`}>{t(`status_${status}`)}</span>;
}
