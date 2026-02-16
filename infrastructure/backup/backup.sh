#!/usr/bin/env sh
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}
SLEEP_SECONDS=${BACKUP_INTERVAL_SECONDS:-86400}
S3_BUCKET=${S3_BUCKET:-}
S3_PREFIX=${S3_PREFIX:-portfolio}
KEEP_LOCAL_BACKUPS=${KEEP_LOCAL_BACKUPS:-false}
RUN_ONCE=${RUN_ONCE:-false}

if [ -z "${POSTGRES_HOST:-}" ] || [ -z "${POSTGRES_DB:-}" ] || [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "[backup] missing required PostgreSQL environment variables"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

while true; do
  TS=$(date +%Y%m%d_%H%M%S)
  RAW_FILE="$BACKUP_DIR/portfolio_${TS}.dump"
  OUTPUT_FILE="$RAW_FILE"

  echo "[backup] creating dump: $RAW_FILE"
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    --format=custom \
    --compress=9 \
    -h "$POSTGRES_HOST" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -f "$RAW_FILE"

  if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    OUTPUT_FILE="${RAW_FILE}.enc"
    echo "[backup] encrypting dump: $OUTPUT_FILE"
    openssl enc -aes-256-cbc -pbkdf2 -salt \
      -in "$RAW_FILE" \
      -out "$OUTPUT_FILE" \
      -pass env:BACKUP_ENCRYPTION_KEY
    rm -f "$RAW_FILE"
  fi

  if [ -n "$S3_BUCKET" ]; then
    OBJECT_KEY="${S3_PREFIX}/$(basename "$OUTPUT_FILE")"
    echo "[backup] uploading to s3://$S3_BUCKET/$OBJECT_KEY"
    aws s3 cp "$OUTPUT_FILE" "s3://$S3_BUCKET/$OBJECT_KEY"
    if [ "$KEEP_LOCAL_BACKUPS" != "true" ]; then
      rm -f "$OUTPUT_FILE"
    fi
  fi

  find "$BACKUP_DIR" -type f \( -name "*.dump" -o -name "*.dump.enc" \) -mtime +"$RETENTION_DAYS" -delete
  if [ "$RUN_ONCE" = "true" ]; then
    echo "[backup] run once completed"
    break
  fi
  echo "[backup] completed, sleep ${SLEEP_SECONDS}s"
  sleep "$SLEEP_SECONDS"
done
