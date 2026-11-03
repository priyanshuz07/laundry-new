export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export type Role = 'admin' | 'subadmin';
export type OrderStatus = 'in_process' | 'done' | 'ready' | 'collected' | 'delivered';
export type ServiceCategory = 'dry_cleaning' | 'press' | 'wash';

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
  service_categories: ServiceCategory[];
  rack_number?: number;
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
  delivered_at?: string | null;
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
  phone?: string | null;
  email?: string | null;
  username?: string | null;
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

export interface DemoSession {
  userId: string;
  name: string;
  role: Role;
  accessToken: string;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const SESSION_KEY = 'lms.api.session';
const AUTH_EXPIRED_EVENT = 'lms:session-expired';
let accessToken: string | null = null;

function savedSession(): DemoSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DemoSession>;
    if (
      typeof value.userId === 'string' &&
      typeof value.name === 'string' &&
      (value.role === 'admin' || value.role === 'subadmin') &&
      typeof value.accessToken === 'string'
    ) {
      accessToken = value.accessToken;
      return value as DemoSession;
    }
    return null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null || !('detail' in payload)) return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item !== 'object' || item === null || !('msg' in item)) return '';
        return String((item as { msg: unknown }).msg);
      })
      .filter(Boolean)
      .join('. ') || fallback;
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError(0, 'Could not connect to the API. Start the FastAPI server and check its URL.');
    }
    throw error;
  }

  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = errorMessage(payload, `Request failed (${response.status})`);
    if (response.status === 401 || (response.status === 403 && message === 'Account is deactivated')) {
      accessToken = null;
      localStorage.removeItem(SESSION_KEY);
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

function sessionFromResponse(value: {
  access_token: string;
  user_id: string;
  name: string;
  role: Role;
}): DemoSession {
  return {
    userId: value.user_id,
    name: value.name,
    role: value.role,
    accessToken: value.access_token,
  };
}

export const demoAuth = {
  async register(name: string, email: string, phone: string, password: string): Promise<DemoSession> {
    const result = await request<{
      access_token: string;
      user_id: string;
      name: string;
      role: Role;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone, password }),
    });
    const session = sessionFromResponse(result);
    accessToken = session.accessToken;
    return session;
  },

  async login(identifier: string, password: string): Promise<DemoSession> {
    const result = await request<{
      access_token: string;
      user_id: string;
      name: string;
      role: Role;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    const session = sessionFromResponse(result);
    accessToken = session.accessToken;
    return session;
  },

  async me(): Promise<DemoSession> {
    const user = await request<{ id: string; name: string; role: Role }>('/api/auth/me');
    const session = savedSession();
    if (!session) throw new ApiError(401, 'Your session has expired. Please sign in again.');
    return { ...session, userId: user.id, name: user.name, role: user.role };
  },

  saveSession(session: DemoSession): void {
    accessToken = session.accessToken;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },

  readSession(): DemoSession | null {
    return savedSession();
  },

  clearSession(): void {
    accessToken = null;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('lms.demo.session');
  },
};

export const api = {
  orders(params: { status?: string; q?: string; page?: number }) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.q) query.set('q', params.q);
    if (params.page) query.set('page', String(params.page));
    return request<{ items: Order[]; total: number; page: number; page_size: number }>(
      `/api/orders?${query.toString()}`,
    );
  },

  order(orderId: string): Promise<Order> {
    return request(`/api/orders/${encodeURIComponent(orderId)}`);
  },

  createOrder(body: unknown): Promise<Order> {
    return request('/api/orders', { method: 'POST', body: JSON.stringify(body) });
  },

  setStatus(orderId: string, status: OrderStatus): Promise<Order> {
    return request(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  setPayment(
    orderId: string,
    amountPaise: number,
    paymentMethod: 'cash' | 'upi' | 'card' = 'cash',
  ): Promise<Order> {
    return request(`/api/orders/${encodeURIComponent(orderId)}/payment`, {
      method: 'PATCH',
      body: JSON.stringify({ amount_paise: amountPaise, payment_method: paymentMethod }),
    });
  },

  deliverOrder(orderId: string): Promise<Order> {
    return request(`/api/orders/${encodeURIComponent(orderId)}/deliver`, { method: 'POST' });
  },

  qr(orderId: string): Promise<{ order_no: string; url: string; data_url: string }> {
    return request(`/api/orders/${encodeURIComponent(orderId)}/qr`);
  },

  catalogue(): Promise<{
    items: { key: string; label: Record<string, string>; price_paise: number }[];
    qualities: string[];
  }> {
    return request('/api/orders/catalogue');
  },

  customers(query = ''): Promise<Customer[]> {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    return request(`/api/customers?${params.toString()}`);
  },

  saveCustomer(input: { name: string; phone: string; address: string; notes: string }): Promise<Customer> {
    return request('/api/customers', { method: 'POST', body: JSON.stringify(input) });
  },

  updateCustomer(
    customerId: string,
    input: { name: string; phone: string; address: string; notes: string },
  ): Promise<Customer> {
    return request(`/api/customers/${encodeURIComponent(customerId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  deleteCustomer(customerId: string): Promise<void> {
    return request(`/api/customers/${encodeURIComponent(customerId)}`, { method: 'DELETE' });
  },

  users(): Promise<StaffUser[]> {
    return request('/api/users');
  },

  createUser(input: { name: string; username: string; phone?: string; password: string }): Promise<StaffUser> {
    return request('/api/users', { method: 'POST', body: JSON.stringify(input) });
  },

  setUserActive(userId: string, active: boolean): Promise<StaffUser> {
    const query = new URLSearchParams({ active: String(active) });
    return request(`/api/users/${encodeURIComponent(userId)}/active?${query}`, { method: 'PATCH' });
  },

  report(granularity: 'day' | 'week' | 'month', days: number) {
    const query = new URLSearchParams({ granularity, days: String(days) });
    return request<{
      granularity: 'day' | 'week' | 'month';
      start: string;
      end: string;
      buckets: ReportBucket[];
      totals: ReportBucket;
    }>(`/api/reports/money?${query}`);
  },

  pendingPayments(): Promise<Order[]> {
    return request('/api/orders/pending-payments');
  },

  dashboard() {
    return request<{
      open_orders: Record<string, number>;
      today: { orders: number; revenue_paise: number; collected_paise: number };
    }>('/api/reports/dashboard');
  },

  publicOrder(token: string): Promise<{
    order_no: string;
    customer_name: string;
    status: OrderStatus;
    service_categories: ServiceCategory[];
    rack_number?: number;
    items: { name: string; quality: string; quantity: number }[];
    total_quantity: number;
  }> {
    return request(`/api/public/orders/${encodeURIComponent(token)}`);
  },
};
