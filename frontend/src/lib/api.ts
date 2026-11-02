/** Typed REST client. One place that knows about tokens and errors. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

let token: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setToken(next: string | null): void {
  token = next;
}

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Network error — check that the server is reachable.');
  }

  if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
      else if (Array.isArray(body?.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join(', ');
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type Role = 'admin' | 'subadmin';
export type OrderStatus = 'in_process' | 'done' | 'ready' | 'collected';

export interface OrderItem {
  name: string;
  category: string;
  quality: 'normal' | 'premium' | 'delicate';
  quantity: number;
  unit_price_paise: number;
  line_total_paise: number;
}

export interface Order {
  id: string;
  order_no: string;
  public_token: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  items: OrderItem[];
  subtotal_paise: number;
  discount_paise: number;
  total_paise: number;
  paid_paise: number;
  balance_paise: number;
  payment_method: string;
  status: OrderStatus;
  note: string;
  created_at: string | null;
  ready_at: string | null;
  collected_at: string | null;
  created_by_name: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  created_at: string | null;
  order_count: number;
}

export interface StaffUser {
  id: string;
  name: string;
  phone: string;
  role: Role;
  is_active: boolean;
  created_at: string | null;
}

export interface ReportBucket {
  period: string;
  order_count: number;
  revenue_paise: number;
  collected_paise: number;
}

export const api = {
  login: (phone: string, password: string) =>
    request<{ access_token: string; role: Role; name: string; user_id: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    }),
  me: () => request<StaffUser>('/api/auth/me'),
  changePassword: (password: string) =>
    request<void>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ password }) }),

  orders: (params: { status?: string; q?: string; page?: number }) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.q) qs.set('q', params.q);
    qs.set('page', String(params.page ?? 1));
    qs.set('page_size', '20');
    return request<{ items: Order[]; total: number; page: number; page_size: number }>(
      `/api/orders?${qs.toString()}`,
    );
  },
  order: (id: string) => request<Order>(`/api/orders/${id}`),
  createOrder: (body: unknown) =>
    request<Order>('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
  setStatus: (id: string, status: OrderStatus) =>
    request<Order>(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  setPayment: (id: string, paid_paise: number) =>
    request<Order>(`/api/orders/${id}/payment`, { method: 'PATCH', body: JSON.stringify({ paid_paise }) }),
  qr: (id: string) => request<{ order_no: string; url: string; data_url: string }>(`/api/orders/${id}/qr`),
  catalogue: () =>
    request<{ items: { key: string; label: Record<string, string>; price_paise: number }[] }>(
      '/api/orders/catalogue',
    ),

  customers: (q = '') => request<Customer[]>(`/api/customers?q=${encodeURIComponent(q)}`),
  saveCustomer: (body: { name: string; phone: string; address: string; notes: string }) =>
    request<Customer>('/api/customers', { method: 'POST', body: JSON.stringify(body) }),

  users: () => request<StaffUser[]>('/api/users'),
  createUser: (body: { name: string; phone: string; password: string }) =>
    request<StaffUser>('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  setUserActive: (id: string, active: boolean) =>
    request<StaffUser>(`/api/users/${id}/active?active=${active}`, { method: 'PATCH' }),

  report: (granularity: 'day' | 'week' | 'month', days: number) =>
    request<{
      granularity: string;
      start: string;
      end: string;
      buckets: ReportBucket[];
      totals: ReportBucket;
    }>(`/api/reports/money?granularity=${granularity}&days=${days}`),
  dashboard: () =>
    request<{
      open_orders: Record<string, number>;
      today: { orders: number; revenue_paise: number; collected_paise: number };
    }>('/api/reports/dashboard'),

  publicOrder: (token: string) =>
    request<{
      order_no: string;
      customer_name: string;
      status: OrderStatus;
      items: { name: string; quality: string; quantity: number }[];
      total_quantity: number;
    }>(`/api/public/orders/${token}`),
};
