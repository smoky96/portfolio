#!/usr/bin/env sh
set -e

cd /app
export PYTHONPATH=/app

alembic -c alembic.ini upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
