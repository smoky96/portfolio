#!/usr/bin/env sh
set -e

BACKUP_DIR=${BACKUP_DIR:-/backups}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-7}
SLEEP_SECONDS=${BACKUP_INTERVAL_SECONDS:-86400}

mkdir -p "$BACKUP_DIR"

while true; do
  TS=$(date +%Y%m%d_%H%M%S)
  FILE="$BACKUP_DIR/portfolio_${TS}.sql"

  echo "[backup] creating $FILE"
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    -h "$POSTGRES_HOST" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    > "$FILE"

  find "$BACKUP_DIR" -type f -name "*.sql" -mtime +"$RETENTION_DAYS" -delete
  echo "[backup] completed, sleep ${SLEEP_SECONDS}s"
  sleep "$SLEEP_SECONDS"
done
