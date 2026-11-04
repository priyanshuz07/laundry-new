# Laundry Management System

A React/Vite frontend with an existing FastAPI backend for customers, orders,
bills, QR lookups, staff management, payments, and reports. The backend stores
application data in MongoDB Atlas.

## Local development with MongoDB

1. Copy `backend\.env.example` to `backend\.env` if needed. Set `MONGODB_URI`
   to your actual Atlas connection string and `MONGODB_DB=laundryDB`. The backend
   rejects local/non-SRV MongoDB URIs. URL-encode special characters in the
   Atlas username or password. Set a private random `JWT_SECRET` and a private
   `BOOTSTRAP_ADMIN_PASSWORD`.

   ```powershell
   if (!(Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
   ```

2. Configure and run the FastAPI backend in PowerShell:

   ```powershell
   cd backend
   py -3.12 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```
   Use Python 3.12 for the pinned backend dependencies. The backend loads
   `backend\.env` with `python-dotenv`; its MongoDB settings use `MONGODB_URI`
   and `MONGODB_DB` (legacy `DB_NAME` is also accepted). If
   `BOOTSTRAP_ADMIN_PASSWORD` is left blank and there is no
   existing Main Admin, login remains unavailable. Set a private
   `BOOTSTRAP_ADMIN_PASSWORD` and restart FastAPI to create the initial Main
   Admin, then sign in with `BOOTSTRAP_ADMIN_PHONE`. The login page does not
   expose public registration. A first-admin-only registration endpoint remains
   available for controlled initial setup.
3. In a second PowerShell window, configure and run the frontend:

   ```powershell
   if (!(Test-Path frontend\.env)) { Copy-Item frontend\.env.example frontend\.env }
   cd frontend
   npm ci
   npm run dev
   ```

   Open the Vite URL (normally `http://127.0.0.1:5173`). Set
   `VITE_API_BASE_URL=http://127.0.0.1:8000` in `frontend\.env`; the frontend
   reads `VITE_API_BASE_URL` (not `VITE_API_URL`). `/api/health` and
   `/api/db-test` report whether MongoDB is reachable.
4. The app uses `users`, `orders`, `payment`, `customers`, `counters`, and
   `whatsapp_outbox` collections. The backend creates indexes on startup.

The backend reuses one asynchronous PyMongo client to avoid blocking FastAPI
request handling. `.env` files are ignored by Git. Never put MongoDB
credentials, JWT secrets, or payment credentials in frontend environment
variables.

## Accounts and access

- The Main Admin is provisioned at first startup or through the restricted
  first-admin endpoint. Sub Admin accounts can only be created by an
  authenticated Main Admin from **Sub Admin Management**.
- Sub Admins sign in using their Sub Admin ID and password. Passwords are
  hashed by the backend. Main Admin-only APIs (reports and account management)
  also enforce role checks server-side.
- Deactivating a Sub Admin is checked against MongoDB on every authenticated
  request, so existing tokens stop authorizing requests immediately. Activating
  the account again restores access without changing its password.
- Staff-recorded cash/UPI/card entries are stored in the `payment` collection
  with a `recorded` status. This app has no payment-provider integration and
  never labels entries `successful` or claims to verify online transactions.
- Existing demo data in browser local storage is not automatically imported to
  MongoDB. Existing MongoDB documents remain in place; older orders without
  service/rack fields remain readable.

## Deployment

Deploy the frontend to Vercel and the backend to a Hugging Face Docker Space:

1. **Frontend:** deploy the Vite app to Vercel. Set `VITE_API_BASE_URL` to the
   backend Space's public HTTPS URL and redeploy.
2. **Backend:** create a Docker Space and upload the contents of `backend/` as
   its repository root. The Space uses `backend/Dockerfile` and
   `backend/README.md` to build and serve FastAPI on port `7860`. Add these
   Space variables and secrets:

   - `MONGODB_URI`: Atlas connection string (`mongodb+srv://...`). URL-encode
     special characters in the database username and password.
   - `MONGODB_DB`: Atlas database name, for example `laundryDB`.
   - `ENVIRONMENT=production`
   - `JWT_SECRET`: a private random value of at least 32 characters.
   - `CORS_ORIGINS`: comma-separated, explicit HTTPS Vercel frontend origins.
   - `PUBLIC_BASE_URL`: the frontend's HTTPS URL.
   - `BOOTSTRAP_ADMIN_PHONE` and `BOOTSTRAP_ADMIN_PASSWORD`: initial admin
     credentials. Set the password only for first startup; clear it after an
     admin has been created.
   - `CRON_SECRET`: a private random value used to authorize the scheduled
     reminder route.
   - Optional `WHATSAPP_PROVIDER`, `WHATSAPP_PHONE_ID`, and `WHATSAPP_TOKEN`
     only if actual WhatsApp delivery is configured.

Configure Atlas Network Access to allow the Space's outbound connections.
Hugging Face Spaces may use changing outbound IPs, so configure an appropriate
Atlas network access policy for your deployment rather than exposing database
credentials to the frontend. The backend reuses one asynchronous MongoDB client
for its lifetime and closes it at shutdown. The in-process reminder scheduler
runs in the Space. Vercel and Hugging Face environment variables are not
inherited from local `.env` files. MongoDB credentials remain backend-only.

The connection pool uses the driver's defaults because expected concurrency is
unknown. Monitor Atlas connection counts alongside Space concurrency and API
latency before changing pool or timeout settings.

## Validation

```powershell
cd frontend
npm run typecheck
npm run build

cd ..\backend
.\.venv\Scripts\Activate.ps1
py -3.12 -m pytest
```

`GET /api/db-test` only returns success after pinging the configured Atlas
cluster. Test API workflows with the in-memory test database:

```powershell
cd backend
py -3.12 -m pytest
```

These tests validate endpoint behavior but do not verify Atlas credentials or
Atlas network access. Verify actual Atlas connectivity separately with:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/db-test
```

For CRUD verification, sign in through `/api/auth/login` to obtain a bearer
token, then use the existing `/api/customers` POST and GET routes, PUT
`/api/customers/{id}`, and DELETE `/api/customers/{id}`. Customers with orders
cannot be deleted. Confirm the document in Atlas Data Explorer after creating
it; it should remain after restarting FastAPI.
