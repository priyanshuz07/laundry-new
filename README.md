# Laundry Management System

A simple, mobile-friendly laundry app: register customers, add clothes, auto-calculate
and print bills, track orders with per-order QR codes, notify customers on WhatsApp,
and give the owner daily/weekly/monthly money reports.

Built exactly to the supplied requirements: **React.js + Tailwind** frontend,
**Python (FastAPI)** backend, **MongoDB Atlas** database, REST API, JWT auth with
Admin/Sub-admin roles, **English / मराठी / हिंदी**.

---

## 1. What is included

```
laundry-lms/
├── backend/                  FastAPI + Motor (async MongoDB)
│   ├── app/
│   │   ├── main.py           app factory, lifespan, CORS, bootstrap admin
│   │   ├── config.py         typed settings from .env
│   │   ├── db.py             Motor client + every index the API relies on
│   │   ├── models.py         Pydantic request/response schemas
│   │   ├── security.py       bcrypt hashing + JWT
│   │   ├── deps.py           current-user and role gates
│   │   ├── money.py          integer-paise billing (pure functions)
│   │   ├── routers/          auth, users, customers, orders, reports, public
│   │   └── services/         qr.py, whatsapp.py, reminders.py
│   └── tests/                22 tests (pure logic + full API flows)
├── frontend/                 React 18 + TypeScript + Vite + Tailwind
│   └── src/
│       ├── pages/            Login, Orders, NewOrder, OrderDetail, Bill,
│       │                     Customers, Reports, Staff, PublicOrder
│       ├── components/       Layout, ProtectedRoute, StatusBadge, LanguageSelect
│       ├── lib/              api client, auth context, useApi hook, money helpers
│       └── i18n/             en / mr / hi dictionaries
├── docker-compose.yml        mongo + api + web, one command
└── README.md
```

## 2. Run it

### Option A — Docker (fastest)

```bash
export JWT_SECRET=$(openssl rand -hex 32)
docker compose up --build
```

* App: <http://localhost:5173>
* API docs: <http://localhost:8000/docs>
* First login: `9999999999` / `AdminPass123` (change it immediately)

### Option B — local development

**Backend**

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # set MONGODB_URI and JWT_SECRET
uvicorn app.main:app --reload --port 8000
```

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env          # API_PROXY_TARGET=http://localhost:8000 for local development
npm run dev
```

The first admin is created automatically on startup when no admin exists, using
`BOOTSTRAP_ADMIN_PHONE` and `BOOTSTRAP_ADMIN_PASSWORD`.

## 3. How each requirement is met

| Requirement | Where |
|---|---|
| Customer name, address, phone | `routers/customers.py`, `pages/NewOrder.tsx` |
| Clothing category or custom item, quality, quantity, price | catalogue endpoint + `pages/NewOrder.tsx` |
| Automatic bill + printing | `money.compute_bill` (server-authoritative), `pages/Bill.tsx` (print CSS) |
| Unique QR per order | `services/qr.py`, `GET /api/orders/{id}/qr` |
| Scanning shows order no, name, clothes | `routers/public.py` → `pages/PublicOrder.tsx` |
| Status: In Process / Done / Ready / Collected | `PATCH /api/orders/{id}/status` with a forward-only state machine |
| WhatsApp message when ready | `services/whatsapp.py`, triggered on the `ready` transition |
| One reminder after 2 days if uncollected | `services/reminders.py` (APScheduler, hourly sweep) |
| Reports for Admin only (daily/weekly/monthly) | `routers/reports.py`, gated by `require_admin` |
| Sub-admin create / activate / deactivate | `routers/users.py`, `pages/Staff.tsx` |
| English, Marathi, Hindi | `src/i18n/index.tsx` |
| Mobile, tablet, desktop | Tailwind layout with bottom nav < 768px |

## 4. Design decisions worth knowing

**Money is integer paise everywhere.** `0.1 + 0.2 != 0.3` in binary floating point, and a
bill that is one paisa wrong is a support ticket. The server recomputes every total from
the line items; a tampered browser cannot change what it costs.

**Roles are re-checked against the database on every request.** A JWT that lives 8 hours
would otherwise keep a deactivated sub-admin logged in until it expired. Deactivation
takes effect on the next click.

**The QR holds an unguessable token, not the order number.** `LMS-2501-0007` is trivial to
guess and would leak every customer's item list. The public endpoint also returns only
order number, customer name, items and status — never phone, address or money.

**WhatsApp sending is idempotent.** Before the network call the order is claimed with an
atomic `findOneAndUpdate` on a `..._sent_at: null` flag, so a retry, a second worker or a
scheduler overlap cannot send the same message twice.

**Order numbers come from an atomic counter, never `count()`.** Two staff creating an
order at the same second still get different numbers.

**Indexes follow the ESR rule** (Equality, Sort, Range) and cover every query:
`{status, created_at}`, `{customer_id, created_at}`, `{created_at, total_paise}` for
reports, and `{status, whatsapp.reminder_sent_at, ready_at}` for the reminder sweep.

**Documents embed what is read together.** Order items and a customer snapshot live inside
the order (one-to-few, always read together, immutable once created); customers and users
are referenced. Unbounded arrays are rejected by validation (max 50 items).

## 5. API reference

```
POST   /api/auth/login                  {phone, password} -> JWT
GET    /api/auth/me
POST   /api/auth/change-password

GET    /api/users                       admin only
POST   /api/users                       admin only
PATCH  /api/users/{id}/active?active=   admin only
POST   /api/users/{id}/password         admin only

GET    /api/customers?q=                staff
POST   /api/customers                   staff
GET    /api/customers/{id}              staff
PUT    /api/customers/{id}              staff

GET    /api/orders/catalogue            staff
POST   /api/orders                      staff
GET    /api/orders?status=&q=&page=     staff
GET    /api/orders/{id}                 staff
PATCH  /api/orders/{id}/status          staff
PATCH  /api/orders/{id}/payment         staff
GET    /api/orders/{id}/qr              staff (JSON data URL)
GET    /api/orders/{id}/qr.png          staff (PNG download)

GET    /api/reports/money?granularity=&days=   admin only
GET    /api/reports/dashboard                  admin only

GET    /api/public/orders/{token}       public, no auth
GET    /api/health
```

## 6. Tests

```bash
cd backend && pip install -r requirements-dev.txt && pytest -q      # 22 passed
cd frontend && npm run typecheck && npm run build
```

The API tests run the real FastAPI app against an in-memory MongoDB
(`mongomock-motor`) and cover: login failures, server-side bill maths, order-number
increments, the status state machine, WhatsApp-on-ready, QR + public lookup privacy,
sub-admin permission denial, immediate deactivation, duplicate phone rejection,
customer reuse by phone, report aggregation, and reminder exactly-once behaviour.

## 7. Production deployment (MongoDB Atlas, Render and Vercel)

The root `vercel.json` builds and serves the Vite frontend from `frontend/`.
Its rewrite fallback serves the React app for direct navigation to client-side
routes. The FastAPI backend is a separate Render web service defined in
`render.yaml`; the Vercel configuration does not combine the two services.

### A. Create a MongoDB Atlas database

1. Create an Atlas project and cluster. Create a database user with a strong,
   unique password and read/write access only to the `laundry` database.
2. In **Network Access**, allow the outbound IP addresses for the selected Vercel
   deployment region/egress configuration. If needed, use a Vercel static
   outbound IP option supported by your plan. Do not expose the database to
   `0.0.0.0/0`.
3. Copy the Atlas `mongodb+srv://` connection string. Replace its username,
   password and database name with the database user's values and `laundry`.
   Keep this value private; only the backend service needs `MONGODB_URI`.

### B. Deploy the backend to Render and frontend to Vercel

1. Deploy the backend using `render.yaml`. Set its environment variables:
   - `ENVIRONMENT=production`
   - `MONGODB_URI` = the private Atlas URI from step A
   - `MONGODB_DB=laundry`
   - `JWT_SECRET` = a cryptographically random value of at least 32 characters
     (generate with `openssl rand -hex 32`)
   - `PUBLIC_BASE_URL` = the Vercel production origin, e.g.
     `https://your-project.vercel.app` (no trailing slash)
   - `CORS_ORIGINS` = the same HTTPS Vercel origin. Do not use `*` or include a
     trailing slash.
   - `BOOTSTRAP_ADMIN_PHONE` and a unique `BOOTSTRAP_ADMIN_PASSWORD` for the
     initial admin account.
2. Optionally configure `WHATSAPP_PROVIDER=meta`, `WHATSAPP_PHONE_ID` and
   `WHATSAPP_TOKEN` on the backend service. Otherwise keep
   `WHATSAPP_PROVIDER=stub`. Keep all backend secrets out of frontend variables
   and source code.
3. Import the repository in Vercel and set **Root Directory** to the repository
   root. The root `vercel.json` installs and builds in `frontend/` and serves
   `frontend/dist`; no separate Vercel project root is needed.
4. In Vercel's **Environment Variables**, set `VITE_API_URL` for the frontend
   build in Production and Preview to the Render backend's HTTPS origin, for
   example `https://laundry-api.onrender.com` (no trailing slash and no `/api`
   suffix). The frontend appends paths such as `/api/auth/login`. Redeploy
   after adding or changing this variable; Vite embeds it at build time. The
   production frontend reports a configuration error instead of sending API
   requests to Vercel's SPA fallback when this variable is missing.
   If the Vercel domain changes, update the backend's `PUBLIC_BASE_URL` and
   `CORS_ORIGINS` and redeploy it; QR codes use `PUBLIC_BASE_URL`.
5. Open `https://<your-backend>.onrender.com/api/health`; it should return
   `{"status":"ok","database":true,...}`.

### C. Verify the live app

1. Open the Vercel URL, sign in with the bootstrap admin, and confirm the
   **Staff** and **Reports** pages are admin-only. Create a sub-admin and verify
   it cannot access those pages or endpoints.
2. Create an order, open its bill and QR code, scan the QR link, update order
   status, search customers and load reports. Confirm browser requests to
   `/api` reach the configured Render backend and succeed.

**Serverless reminder note:** the backend starts an in-process APScheduler for
WhatsApp reminders. Vercel Functions may scale to multiple instances or pause
between requests, so this scheduler is not a reliable production clock there.
If scheduled reminders must run reliably, deploy the backend on an always-on
service such as Render (using `render.yaml`) or move reminders to a dedicated
external scheduler.

The backend validates the production JWT secret, MongoDB URI, HTTPS CORS origins
and public frontend URL at startup. Database credentials and other backend
secrets belong only in backend environment settings; never expose or commit them.

## 8. Before going live

1. Set a real `JWT_SECRET` (`openssl rand -hex 32`). Production startup rejects
   the development default or a key shorter than 32 characters.
2. Change the bootstrap admin password after the first login.
3. Set `WHATSAPP_PROVIDER=meta` with `WHATSAPP_PHONE_ID` and `WHATSAPP_TOKEN`. Until then
   every message is recorded in the `whatsapp_outbox` collection with status `simulated`,
   so the flow can be demonstrated end to end without a Meta account.
4. Serve over HTTPS (both hosts provide it by default) and enable MongoDB Atlas backups.
5. WhatsApp only allows free-form text inside a 24-hour customer service window. For a
   cold "your order is ready" message, register a **message template** in Meta Business
   Manager and switch `send_message` to the `template` payload type — the outbox and
   idempotency logic stay unchanged.
