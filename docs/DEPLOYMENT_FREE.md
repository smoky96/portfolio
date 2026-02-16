# Free Hosting Deployment Guide

This guide deploys the current repository as a full-stack app with free tiers:

- Frontend: Cloudflare Pages
- Backend API: Render Web Service (Docker)
- Database: Supabase Postgres or Neon Postgres

This setup works with the current architecture:

- FastAPI backend in `backend/`
- Vite React frontend in `frontend/`
- Cookie-based auth (`credentials: include`)

## 0. Prerequisites

- A GitHub repo for this project
- A Render account
- A Cloudflare account
- A Supabase or Neon account

## 1. Prepare Production Values

Create production env values from `.env.prod.example`.

Critical values you must set:

- `APP_ENV=prod`
- `DATABASE_URL=<managed postgres url>`
- `JWT_SECRET_KEY=<long random secret, at least 32 chars>`
- `BOOTSTRAP_ADMIN_PASSWORD=<strong password>`
- `BOOTSTRAP_ADMIN_INVITE_CODE=<unique non-default value>`
- `ALLOW_SELF_REGISTRATION=false`
- `EXPOSE_API_DOCS=false`
- `COOKIE_SECURE=true`
- `VITE_ALLOW_SELF_REGISTRATION=false`

Values that depend on your final domains:

- `CORS_ALLOWED_ORIGINS=https://<frontend-domain>`
- `COOKIE_SAMESITE=none` when frontend and API are on different sites
- `COOKIE_SAMESITE=lax` when frontend and API are same-site
- `COOKIE_DOMAIN=` leave empty for default platform domains

## 2. Create Managed Postgres

Create a database in Supabase or Neon, then copy the connection URL.

Use it as `DATABASE_URL`, for example:

```txt
postgresql+psycopg2://<user>:<password>@<host>:5432/<db>?sslmode=require
```

Notes:

- `sslmode=require` is usually needed on managed Postgres.
- Do not use the local Docker `db` hostname in production.

## 3. Deploy Backend (Render)

1. In Render, create a new Web Service from your GitHub repo.
2. Runtime: Docker.
3. Root Directory: `backend`.
4. Dockerfile path: `Dockerfile` (inside `backend/`).
5. Health Check Path: `/health`.
6. Add environment variables from Step 1.
7. Set `CORS_ALLOWED_ORIGINS` to your frontend URL.
8. Deploy.

Why this works with no code changes:

- `backend/start.sh` already runs `alembic upgrade head` before starting Uvicorn.
- The app exposes `/health` for platform health checks.

After deploy, copy the backend public URL, for example:

```txt
https://portfolio-api.onrender.com
```

## 4. Deploy Frontend (Cloudflare Pages)

1. In Cloudflare Pages, connect the same GitHub repo.
2. Set build options (manual configuration works even if `Vite` preset is not shown):
   - Framework preset: `None` (or `Vite` if available)
   - Do not choose `VitePress` for this project
   - Root directory: `frontend`
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Add environment variables:
   - `NODE_VERSION=22`
   - `VITE_API_BASE=https://<render-backend-domain>/api/v1`
   - `VITE_ALLOW_SELF_REGISTRATION=false`
4. Deploy and get the frontend URL, for example:
   - `https://portfolio-web.pages.dev`

## 5. Finalize Cross-Origin Cookie Settings

Update backend env on Render to match the final frontend URL:

- `CORS_ALLOWED_ORIGINS=https://<your-pages-or-custom-domain>`
- Keep `COOKIE_SECURE=true`
- For cross-site frontend/backend, use `COOKIE_SAMESITE=none`
- Keep `COOKIE_DOMAIN` empty unless you use a shared parent domain

Redeploy backend after env updates.

## 6. Bootstrap Admin (One Time)

Open Render Shell for the backend service and run:

```bash
python -m app.scripts.bootstrap_admin
```

This creates/ensures the bootstrap admin user and invite code.

## 7. Verify

Run these checks:

```bash
curl -i https://<render-backend-domain>/health
```

Expected: `200 OK`.

In browser:

- Open frontend URL.
- Login with bootstrap admin credentials.
- Confirm API calls succeed and session persists.

Security checks:

- `/api/docs` should be unavailable in production.
- Self registration should be disabled.

## 8. Known Free-Tier Limits

- Free backend instances can sleep when idle, causing cold starts.
- In-app scheduler jobs pause while service is sleeping.
- Backup worker from `docker-compose.prod.yml` is not included in this free split setup.

For stronger uptime and scheduled jobs, move backend/worker to a paid tier.

## 9. Optional Custom Domains

Recommended:

- Frontend: `app.example.com` (Cloudflare Pages)
- Backend: `api.example.com` (Render)

Then set:

- `CORS_ALLOWED_ORIGINS=https://app.example.com`
- `COOKIE_DOMAIN=.example.com` (optional, only when you need shared cookie scope)
- `VITE_API_BASE=https://api.example.com/api/v1`

## 10. Rollback Strategy (Practical)

- Keep previous backend env values in Render environment history.
- Keep previous frontend deployment in Cloudflare Pages deployment history.
- Roll back frontend first if UI breaks.
- Roll back backend if API or auth flow breaks.
