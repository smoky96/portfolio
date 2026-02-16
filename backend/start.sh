#!/usr/bin/env sh
set -e

cd /app
export PYTHONPATH=/app

/opt/venv/bin/alembic -c alembic.ini upgrade head
exec /opt/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
