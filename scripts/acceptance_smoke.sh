#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/6] Starting core services..."
docker compose up -d db backend frontend nginx

echo "[2/6] Seeding mock data..."
docker compose exec -T backend python -m app.scripts.seed_mock_data

echo "[3/6] Running backend test suite with 80% coverage gate..."
docker run --rm -v "$ROOT_DIR/backend:/app" -w /app python:3.12-slim bash -lc 'python -m venv /tmp/venv && . /tmp/venv/bin/activate && pip install -q -r requirements.txt && PYTHONPATH=/app pytest'

echo "[4/6] Checking health endpoint through nginx..."
curl -fsS http://localhost:8080/health >/dev/null

echo "[5/6] Checking dashboard summary through nginx with cookie auth..."
COOKIE_JAR="$(mktemp)"
curl -fsS -c "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  http://localhost:8080/api/v1/auth/login >/dev/null
curl -fsS -b "$COOKIE_JAR" http://localhost:8080/api/v1/dashboard/summary >/dev/null
rm -f "$COOKIE_JAR"

echo "[6/6] Running frontend Playwright smoke suite..."
(
  cd frontend
  npm ci
  npx playwright install chromium
  PLAYWRIGHT_BASE_URL=http://localhost:8080 \
  PLAYWRIGHT_AUTH_USER=admin \
  PLAYWRIGHT_AUTH_PASS=admin123 \
  npm run test:e2e:smoke
)

echo "Acceptance smoke completed successfully."
