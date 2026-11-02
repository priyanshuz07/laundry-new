# Laundry Management System

A React/Vite frontend with an existing FastAPI backend for customers, orders,
bills, QR lookups, staff management, payments, and reports. The backend stores
application data in MongoDB; it connects to the local `laundryDB` database by
default.

## Local development with MongoDB

1. Start MongoDB Community Server. In MongoDB Compass, connect to:
   `mongodb://localhost:27017/`
2. Configure and run the FastAPI backend in PowerShell:

   ```powershell
   if (!(Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
   cd backend
   py -3.12 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```

   Use Python 3.12 for the pinned backend dependencies. The backend loads
   `backend\.env` with `python-dotenv`; its MongoDB settings use
   `MONGODB_URL` and `DB_NAME=laundryDB`. Set a private random
   `JWT_SECRET` in `backend\.env`. If `BOOTSTRAP_ADMIN_PASSWORD` is left blank,
   and there is no existing Main Admin, login remains unavailable. Set a private
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

   Open the Vite URL (normally `http://127.0.0.1:5173`). The frontend calls the
   backend at `http://127.0.0.1:8000`; `/api/health` and `/api/db-test` report
   whether MongoDB is reachable.
4. In Compass, open `laundryDB`. The app uses `users`, `orders`, and `payment`.
   The existing customer directory and backend services also use `customers`,
   `counters`, and `whatsapp_outbox`. The backend creates indexes on startup.

The backend reuses its existing asynchronous Motor client, backed by the
PyMongo driver, to avoid blocking FastAPI request handling. Both `pymongo` and
`python-dotenv` are backend dependencies. `.env` files are ignored by Git. Never put MongoDB credentials,
JWT secrets, or payment credentials in frontend environment variables.

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

## Deployment limitation

`mongodb://localhost:27017/` is for local development only. A frontend hosted
on Vercel cannot connect to MongoDB running on the developer's computer. For a
deployed app, host the FastAPI backend and MongoDB on reachable infrastructure,
configure backend CORS and secrets there, and set the frontend build variable
`VITE_API_BASE_URL` to the backend's public HTTPS URL. Do not expose a database
URI or database credentials to the browser. The existing Vercel static
configuration deploys only the frontend; it does not deploy this FastAPI
backend or provide access to local MongoDB.

## Validation

```powershell
cd frontend
npm run typecheck
npm run build

cd ..\backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
py -3.12 -m pytest
```
