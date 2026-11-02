import QRCode from 'qrcode';

const STORAGE_KEY = 'lms.demo.data';
const SESSION_KEY = 'lms.demo.session';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
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
  email?: string;
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

interface StoredUser extends StaffUser {
  password_salt: string;
  password_hash: string;
}

interface Store {
  users: StoredUser[];
  customers: Customer[];
  orders: Order[];
}

export interface DemoSession {
  userId: string;
  name: string;
  role: Role;
}

const emptyStore = (): Store => ({ users: [], customers: [], orders: [] });

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const store: unknown = JSON.parse(raw);
    if (
      typeof store !== 'object' ||
      store === null ||
      !Array.isArray((store as Store).users) ||
      !Array.isArray((store as Store).customers) ||
      !Array.isArray((store as Store).orders)
    ) {
      throw new Error('Saved demo data is invalid. Clear this site’s local storage to restart.');
    }
    return store as Store;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Saved demo data could not be read. Clear this site’s local storage to restart.');
    }
    throw error;
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('Browser storage is full. Remove some saved demo data and try again.');
    }
    throw error;
  }
}

function id(): string {
  return crypto.randomUUID();
}

function encode(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations: 120_000,
    },
    key,
    256,
  );
  return encode(new Uint8Array(hash));
}

async function makeStoredUser(input: {
  name: string;
  email?: string;
  phone?: string;
  password: string;
  role: Role;
}): Promise<StoredUser> {
  const salt = encode(crypto.getRandomValues(new Uint8Array(16)));
  return {
    id: id(),
    name: input.name.trim(),
    email: input.email?.trim().toLowerCase(),
    phone: input.phone ?? '',
    role: input.role,
    is_active: true,
    created_at: new Date().toISOString(),
    password_salt: salt,
    password_hash: await hashPassword(input.password, salt),
  };
}

function publicUser(user: StoredUser): StaffUser {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    is_active: user.is_active,
    created_at: user.created_at,
  };
}

function requireOrder(store: Store, orderId: string): Order {
  const order = store.orders.find((candidate) => candidate.id === orderId);
  if (!order) throw new ApiError(404, 'Order not found');
  return order;
}

const CATALOGUE = [
  { key: 'shirt', label: { en: 'Shirt', mr: 'शर्ट', hi: 'शर्ट' }, price_paise: 2000 },
  { key: 'pant', label: { en: 'Trouser', mr: 'पँट', hi: 'पैंट' }, price_paise: 3000 },
  { key: 'saree', label: { en: 'Saree', mr: 'साडी', hi: 'साड़ी' }, price_paise: 7000 },
  { key: 'kurta', label: { en: 'Kurta', mr: 'कुर्ता', hi: 'कुर्ता' }, price_paise: 2500 },
  { key: 'bedsheet', label: { en: 'Bedsheet', mr: 'चादर', hi: 'चादर' }, price_paise: 5000 },
  { key: 'blanket', label: { en: 'Blanket', mr: 'पांघरूण', hi: 'कंबल' }, price_paise: 12000 },
  { key: 'jacket', label: { en: 'Jacket', mr: 'जॅकेट', hi: 'जैकेट' }, price_paise: 8000 },
  { key: 'custom', label: { en: 'Custom item', mr: 'इतर वस्तू', hi: 'अन्य वस्तु' }, price_paise: 0 },
];

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  in_process: ['done', 'ready'],
  done: ['ready'],
  ready: ['collected'],
  collected: [],
};

function reportPeriod(date: Date, granularity: 'day' | 'week' | 'month'): string {
  const start = new Date(date);
  if (granularity === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else if (granularity === 'month') {
    start.setDate(1);
  }
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

async function makeReport(granularity: 'day' | 'week' | 'month', days: number) {
  const store = readStore();
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const grouped = new Map<string, ReportBucket>();
  for (const order of store.orders) {
    if (!order.created_at) continue;
    const created = new Date(order.created_at);
    if (created < start || created > end) continue;
    const period = reportPeriod(created, granularity);
    const bucket = grouped.get(period) ?? {
      period,
      order_count: 0,
      revenue_paise: 0,
      collected_paise: 0,
    };
    bucket.order_count += 1;
    bucket.revenue_paise += order.total_paise;
    bucket.collected_paise += order.paid_paise;
    grouped.set(period, bucket);
  }
  const buckets = [...grouped.values()].sort((a, b) => a.period.localeCompare(b.period));
  const totals = buckets.reduce(
    (total, bucket) => ({
      period: '',
      order_count: total.order_count + bucket.order_count,
      revenue_paise: total.revenue_paise + bucket.revenue_paise,
      collected_paise: total.collected_paise + bucket.collected_paise,
    }),
    { period: '', order_count: 0, revenue_paise: 0, collected_paise: 0 },
  );
  return { granularity, start: start.toISOString(), end: end.toISOString(), buckets, totals };
}

export const demoAuth = {
  async register(name: string, email: string, password: string): Promise<DemoSession> {
    if (name.trim().length < 2) throw new ApiError(400, 'Enter your name');
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new ApiError(400, 'Enter a valid email address');
    }
    if (password.length < 8) throw new ApiError(400, 'Password must be at least 8 characters');

    const store = readStore();
    if (store.users.some((user) => user.email === normalizedEmail)) {
      throw new ApiError(409, 'An account with this email already exists');
    }
    const user = await makeStoredUser({
      name,
      email: normalizedEmail,
      password,
      role: 'admin',
    });
    store.users.push(user);
    writeStore(store);
    return { userId: user.id, name: user.name, role: user.role };
  },

  async login(identifier: string, password: string): Promise<DemoSession> {
    const normalized = identifier.trim().toLowerCase();
    const user = readStore().users.find(
      (candidate) => candidate.email === normalized || candidate.phone === identifier.trim(),
    );
    if (!user || !user.is_active || (await hashPassword(password, user.password_salt)) !== user.password_hash) {
      throw new ApiError(401, 'Incorrect email/phone or password');
    }
    return { userId: user.id, name: user.name, role: user.role };
  },

  me(userId: string): DemoSession | null {
    const user = readStore().users.find((candidate) => candidate.id === userId && candidate.is_active);
    return user ? { userId: user.id, name: user.name, role: user.role } : null;
  },

  saveSession(session: DemoSession): void {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },

  readSession(): DemoSession | null {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as DemoSession;
      if (typeof session.userId !== 'string' || typeof session.name !== 'string') return null;
      return this.me(session.userId);
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  },

  clearSession(): void {
    localStorage.removeItem(SESSION_KEY);
  },
};

export const api = {
  async orders(params: { status?: string; q?: string; page?: number }) {
    const store = readStore();
    const page = params.page ?? 1;
    const pageSize = 20;
    const term = (params.q ?? '').toLowerCase();
    const filtered = store.orders
      .filter((order) => !params.status || order.status === params.status)
      .filter((order) =>
        !term || [order.order_no, order.customer_name, order.customer_phone].some((value) => value.toLowerCase().includes(term)),
      )
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      page_size: pageSize,
    };
  },

  async order(orderId: string): Promise<Order> {
    return requireOrder(readStore(), orderId);
  },

  async createOrder(body: unknown): Promise<Order> {
    const input = body as {
      customer: { name: string; phone: string; address?: string; notes?: string };
      items: Omit<OrderItem, 'line_total_paise'>[];
      discount_paise?: number;
      paid_paise?: number;
      payment_method?: string;
      note?: string;
    };
    if (!input.customer?.name || !input.customer.phone || !input.items?.length) {
      throw new ApiError(400, 'Customer details and at least one item are required');
    }

    const store = readStore();
    const now = new Date();
    let customer = store.customers.find((candidate) => candidate.phone === input.customer.phone);
    if (!customer) {
      customer = {
        id: id(),
        name: input.customer.name,
        phone: input.customer.phone,
        address: input.customer.address ?? '',
        notes: input.customer.notes ?? '',
        created_at: now.toISOString(),
        order_count: 0,
      };
      store.customers.push(customer);
    } else {
      customer.name = input.customer.name;
      customer.address = input.customer.address ?? '';
    }

    const items: OrderItem[] = input.items.map((item) => ({
      ...item,
      line_total_paise: item.quantity * item.unit_price_paise,
    }));
    const subtotal = items.reduce((sum, item) => sum + item.line_total_paise, 0);
    const discount = Math.min(Math.max(0, input.discount_paise ?? 0), subtotal);
    const total = subtotal - discount;
    const orderPrefix = `LMS-${now.toISOString().slice(2, 7).replace('-', '')}-`;
    const orderSequence =
      store.orders.filter((candidate) => candidate.order_no.startsWith(orderPrefix)).length + 1;
    const order: Order = {
      id: id(),
      order_no: `${orderPrefix}${String(orderSequence).padStart(4, '0')}`,
      public_token: id(),
      customer_id: customer.id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_address: customer.address,
      items,
      subtotal_paise: subtotal,
      discount_paise: discount,
      total_paise: total,
      paid_paise: Math.min(Math.max(0, input.paid_paise ?? 0), total),
      balance_paise: Math.max(0, total - Math.min(Math.max(0, input.paid_paise ?? 0), total)),
      payment_method: input.payment_method ?? 'cash',
      status: 'in_process',
      note: input.note ?? '',
      created_at: now.toISOString(),
      ready_at: null,
      collected_at: null,
      created_by_name: demoAuth.readSession()?.name ?? '',
    };
    store.orders.push(order);
    customer.order_count = store.orders.filter((candidate) => candidate.customer_id === customer?.id).length;
    writeStore(store);
    return order;
  },

  async setStatus(orderId: string, status: OrderStatus): Promise<Order> {
    const store = readStore();
    const order = requireOrder(store, orderId);
    if (order.status === status) return order;
    if (!ALLOWED_TRANSITIONS[order.status].includes(status)) {
      throw new ApiError(409, `Cannot change status from ${order.status} to ${status}`);
    }
    order.status = status;
    if (status === 'ready') order.ready_at = new Date().toISOString();
    if (status === 'collected') {
      order.collected_at = new Date().toISOString();
      order.paid_paise = order.total_paise;
      order.balance_paise = 0;
    }
    writeStore(store);
    return order;
  },

  async setPayment(orderId: string, paidPaise: number): Promise<Order> {
    const store = readStore();
    const order = requireOrder(store, orderId);
    if (paidPaise < 0 || paidPaise > order.total_paise) throw new ApiError(400, 'Invalid payment amount');
    order.paid_paise = paidPaise;
    order.balance_paise = order.total_paise - paidPaise;
    writeStore(store);
    return order;
  },

  async qr(orderId: string) {
    const order = requireOrder(readStore(), orderId);
    const url = `${window.location.origin}/o/${order.public_token}`;
    return { order_no: order.order_no, url, data_url: await QRCode.toDataURL(url) };
  },

  async catalogue() {
    return { items: CATALOGUE };
  },

  async customers(query = ''): Promise<Customer[]> {
    const store = readStore();
    const term = query.toLowerCase();
    return store.customers
      .filter((customer) => !term || [customer.name, customer.phone].some((value) => value.toLowerCase().includes(term)))
      .map((customer) => ({
        ...customer,
        order_count: store.orders.filter((order) => order.customer_id === customer.id).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async saveCustomer(input: { name: string; phone: string; address: string; notes: string }): Promise<Customer> {
    const store = readStore();
    let customer = store.customers.find((candidate) => candidate.phone === input.phone);
    if (customer) {
      Object.assign(customer, input);
    } else {
      customer = {
        ...input,
        id: id(),
        created_at: new Date().toISOString(),
        order_count: 0,
      };
      store.customers.push(customer);
    }
    writeStore(store);
    return customer;
  },

  async users(): Promise<StaffUser[]> {
    return readStore().users.map(publicUser);
  },

  async createUser(input: { name: string; phone: string; password: string }): Promise<StaffUser> {
    const store = readStore();
    if (store.users.some((user) => user.phone === input.phone)) {
      throw new ApiError(409, 'An account with this phone number already exists');
    }
    if (input.password.length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
    const user = await makeStoredUser({ ...input, role: 'subadmin' });
    store.users.push(user);
    writeStore(store);
    return publicUser(user);
  },

  async setUserActive(userId: string, active: boolean): Promise<StaffUser> {
    const store = readStore();
    const user = store.users.find((candidate) => candidate.id === userId);
    if (!user) throw new ApiError(404, 'User not found');
    user.is_active = active;
    writeStore(store);
    return publicUser(user);
  },

  async report(granularity: 'day' | 'week' | 'month', days: number) {
    return makeReport(granularity, days);
  },

  async dashboard() {
    const orders = readStore().orders;
    const today = new Date().toDateString();
    const todayOrders = orders.filter(
      (order) => order.created_at && new Date(order.created_at).toDateString() === today,
    );
    const openOrders: Record<string, number> = {
      in_process: 0,
      done: 0,
      ready: 0,
      collected: 0,
    };
    for (const order of orders) openOrders[order.status] += 1;
    return {
      open_orders: openOrders,
      today: {
        orders: todayOrders.length,
        revenue_paise: todayOrders.reduce((sum, order) => sum + order.total_paise, 0),
        collected_paise: todayOrders.reduce((sum, order) => sum + order.paid_paise, 0),
      },
    };
  },

  async publicOrder(token: string) {
    const order = readStore().orders.find((candidate) => candidate.public_token === token);
    if (!order) throw new ApiError(404, 'Order not found on this browser');
    return {
      order_no: order.order_no,
      customer_name: order.customer_name,
      status: order.status,
      items: order.items.map(({ name, quality, quantity }) => ({ name, quality, quantity })),
      total_quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    };
  },
};
