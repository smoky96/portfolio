# Portfolio Manager MVP

A full-stack portfolio management app with:
- FastAPI backend
- React + Vite frontend
- PostgreSQL database
- Docker Compose deployment
- Nginx reverse proxy
- Scheduled `pg_dump` backup worker

## Quick Start (Development)

1. Prepare env:

```bash
cp .env.example .env
```

2. Start services:

```bash
docker compose up --build -d
```

3. Bootstrap initial admin account and invite code:

```bash
docker compose exec -T backend python -m app.scripts.bootstrap_admin
```

4. Open app:

- App: `http://localhost:8080`
- Login with `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` from `.env`

5. API docs:

- Available at `http://localhost:8080/api/docs` when `EXPOSE_API_DOCS=true`

## Production Baseline (Compose)

1. Create production env file:

```bash
cp .env.prod.example .env.prod
```

2. Fill all placeholders in `.env.prod`:

- strong `JWT_SECRET_KEY`
- strong `BOOTSTRAP_ADMIN_PASSWORD`
- non-default `BOOTSTRAP_ADMIN_INVITE_CODE`
- managed PostgreSQL `DATABASE_URL`
- backup encryption + object storage settings

3. Deploy:

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml up -d --build
```

4. Bootstrap admin once:

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml exec -T backend python -m app.scripts.bootstrap_admin
```

For free-tier split deployment (Cloudflare Pages + Render + managed Postgres), see:

- `docs/DEPLOYMENT_FREE.md`

## Security Defaults

- Browser auth uses `HttpOnly` cookie.
- Frontend no longer stores auth token in localStorage.
- In production (`APP_ENV=prod`), startup fails if weak defaults are detected.
- Self registration and API docs must be disabled in production.

## Repository Layout

- `/backend`: FastAPI app, SQLAlchemy models, Alembic migration, tests
- `/frontend`: React SPA
- `/infrastructure/nginx`: reverse proxy config
- `/infrastructure/backup`: backup/restore scripts and image
- `/docs`: API/deployment/operations docs

## Local Development

Backend:

```bash
cd backend
pip install -r requirements.txt
alembic -c alembic.ini upgrade head
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm ci
npm run dev
```

## Testing

Backend:

```bash
docker run --rm -v $(pwd)/backend:/app -w /app python:3.12-slim \
  bash -lc 'python -m venv /tmp/venv && . /tmp/venv/bin/activate && pip install -q -r requirements.txt && PYTHONPATH=/app pytest'
```

Frontend build:

```bash
cd frontend
npm ci
npm run build
```

Frontend smoke E2E:

```bash
cd frontend
npx playwright install chromium
PLAYWRIGHT_BASE_URL=http://localhost:8080 PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:smoke
```

## One-Click Acceptance Smoke

```bash
./scripts/acceptance_smoke.sh
```

This script will:
- start core services (`db/backend/frontend/nginx`)
- seed deterministic mock data
- run backend tests with 80% coverage gate
- verify `/health` and dashboard API with cookie auth through nginx
- run frontend smoke E2E (Chromium)

## CI

- Backend CI: `.github/workflows/backend-ci.yml`
  - lint, dependency audit, pytest coverage gate
- Frontend CI: `.github/workflows/frontend-ci.yml`
  - dependency audit, build, bundle-size report, smoke E2E
