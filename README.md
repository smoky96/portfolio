# Portfolio Manager MVP

A full-stack portfolio management MVP with:
- FastAPI backend
- React + Vite frontend
- PostgreSQL database
- Docker Compose deployment
- Nginx Basic Auth gateway
- Daily `pg_dump` backup worker

## Quick Start

1. Copy environment file:

```bash
cp .env.example .env
```

2. Start all services:

```bash
docker compose up --build -d
```

3. Open:

- App: `http://localhost:8080`
- Username: `admin`
- Password: `admin123`

4. API docs (after auth):

- `http://localhost:8080/api/docs`

## Repository Layout

- `/backend`: FastAPI app, SQLAlchemy models, Alembic migration, tests
- `/frontend`: React SPA
- `/infrastructure/nginx`: Reverse proxy + Basic Auth
- `/infrastructure/backup`: Backup script
- `/docs`: API and deployment docs

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
npm install
npm run dev
```

## Test

```bash
cd backend
pytest app/tests -q
```

With coverage gate (80%+):

```bash
docker compose exec -T backend sh -lc 'cd /app && PYTHONPATH=/app pytest'
```

Quick targets:

```bash
make test-backend
make coverage-backend
make frontend-build
make e2e-smoke
make e2e-transactions
make e2e-regression
make e2e-smoke-mobile
```

Frontend E2E smoke (Playwright):

```bash
cd frontend
npm install
npx playwright install chromium
PLAYWRIGHT_BASE_URL=http://localhost:8080 \
PLAYWRIGHT_AUTH_USER=admin \
PLAYWRIGHT_AUTH_PASS=admin123 \
npm run test:e2e:smoke
# transactions regression
npm run test:e2e:transactions
# full regression (smoke + transactions)
npm run test:e2e:regression
# or
make e2e-regression
```

## Seed Mock Data

```bash
docker compose exec -T backend python -m app.scripts.seed_mock_data
```

## One-Click Acceptance Smoke

```bash
./scripts/acceptance_smoke.sh
# or
make acceptance-smoke
```

This command will:
- start core services (`db/backend/frontend/nginx`)
- seed deterministic mock data
- run backend pytest with 80% coverage gate
- verify `/health` and `/api/v1/dashboard/summary` through nginx + Basic Auth
- run frontend Playwright regression suite (smoke + transactions)

## CI

- Backend CI: `/Users/dong/Devlopment/portfolio/.github/workflows/backend-ci.yml`
  - runs pytest with 80% coverage gate
- Frontend CI: `/Users/dong/Devlopment/portfolio/.github/workflows/frontend-ci.yml`
  - `push/pull_request`: frontend build
  - `workflow_dispatch`: optional Playwright regression (`run_e2e=true`, smoke + transactions)
