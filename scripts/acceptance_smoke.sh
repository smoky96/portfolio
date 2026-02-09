#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/6] Starting core services..."
docker compose up -d db backend frontend nginx

echo "[2/6] Seeding mock data..."
docker compose exec -T backend python -m app.scripts.seed_mock_data

echo "[3/6] Running backend test suite with 80% coverage gate..."
docker compose exec -T backend sh -lc 'cd /app && PYTHONPATH=/app pytest'

echo "[4/6] Checking health endpoint through nginx..."
docker compose exec -T nginx sh -lc 'AUTH=$(printf "admin:admin123" | base64); wget -qO- --header "Authorization: Basic $AUTH" http://127.0.0.1:80/health'

echo "[5/6] Checking dashboard summary through nginx..."
docker compose exec -T nginx sh -lc 'AUTH=$(printf "admin:admin123" | base64); wget -qO- --header "Authorization: Basic $AUTH" http://127.0.0.1:80/api/v1/dashboard/summary >/dev/null'

echo "[6/6] Running frontend Playwright regression (smoke + transactions)..."
docker compose exec -T frontend sh -lc 'cd /app && PLAYWRIGHT_BASE_URL=http://nginx PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:regression'

echo "Acceptance smoke completed successfully."
