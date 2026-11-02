# Laundry Management System

A mobile-friendly laundry app for managing customers, orders, bills, order status,
QR lookups, staff, and reports. The deployed frontend is a browser-only demo:
application data and accounts stay in that browser's local storage. It does not
connect to a database or backend service.

## Run locally

```bash
cd frontend
npm ci
npm run dev
```

Or build and run the static site with Docker:

```bash
docker compose up --build
```

Open the local Vite or Docker URL and create a demo account from the sign-in
screen. No environment variables, API server, or database are required.

## Demo behavior and security

- Register with a name, email, and password. Sign in with that email, or with a
  phone number for a sub-admin account created on the Staff page.
- Demo users, orders, customers, reports, and staff are saved in browser local
  storage and survive refreshes in that browser.
- Passwords are stored only as salted hashes, never as plaintext. Do not use
  real passwords or sensitive customer information: browser storage and
  client-side authentication are not secure production authentication.
- Each new registration is an admin account. Admins can create demo sub-admins
  from the Staff page.
- QR lookup works in the browser that holds the demo data. Another browser or
  device has a separate local store and cannot look up that order.
- This offline demo does not send WhatsApp messages or synchronize data between
  users or devices.

Clearing this site's browser storage removes demo accounts and application
data. Register a new account to start over.

## Deploy to Vercel

Import the repository with its root directory set to the repository root.
The root `vercel.json` builds the Vite app from `frontend/`, serves
`frontend/dist`, and rewrites client-side routes to the app entry point. No
Vercel environment variables, backend, or database setup is required.

## Validation

```bash
cd frontend
npm run typecheck
npm run build
```

The `backend/` directory contains the previous FastAPI implementation and is
not used or deployed by this browser-only demo.
