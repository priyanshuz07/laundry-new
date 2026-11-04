---
title: Laundry Backend
sdk: docker
app_port: 7860
---

FastAPI backend for the Laundry Management System. It serves authentication,
customer and order management, reports, public order lookups, and reminders.
Application data is stored in MongoDB Atlas through the asynchronous PyMongo
client.

Configure the Space secrets and variables before starting the service:

- `MONGODB_URI`: MongoDB Atlas `mongodb+srv://` connection string.
- `MONGODB_DB`: database name.
- `ENVIRONMENT=production`.
- `JWT_SECRET`: private random value of at least 32 characters.
- `CORS_ORIGINS`: comma-separated, explicit HTTPS origins for the deployed
  frontend. Do not use `*`.
- `PUBLIC_BASE_URL`: the frontend's HTTPS URL, used for public order links.
- `BOOTSTRAP_ADMIN_PHONE` and `BOOTSTRAP_ADMIN_PASSWORD`: initial admin
  credentials. The password is only used when no admin account exists.
- `CRON_SECRET`: private secret for authorizing the reminder endpoint.

The optional WhatsApp integration uses `WHATSAPP_PROVIDER=stub` by default.
Set `WHATSAPP_PROVIDER=meta`, `WHATSAPP_PHONE_ID`, and `WHATSAPP_TOKEN` only
when Meta WhatsApp delivery is configured. Other settings and local-development
defaults are documented in `.env.example`.
