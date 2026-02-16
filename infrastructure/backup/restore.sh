#!/usr/bin/env sh
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
S3_BUCKET=${S3_BUCKET:-}
S3_PREFIX=${S3_PREFIX:-portfolio}
RESTORE_FILE=${RESTORE_FILE:-}
RESTORE_S3_KEY=${RESTORE_S3_KEY:-}

if [ -z "${POSTGRES_HOST:-}" ] || [ -z "${POSTGRES_DB:-}" ] || [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "[restore] missing required PostgreSQL environment variables"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

download_from_s3() {
  key="$1"
  local_path="$BACKUP_DIR/$(basename "$key")"
  aws s3 cp "s3://$S3_BUCKET/$key" "$local_path"
  echo "$local_path"
}

pick_latest_local() {
  ls -1t "$BACKUP_DIR"/portfolio_*.dump* 2>/dev/null | head -n 1 || true
}

pick_latest_s3_key() {
  aws s3api list-objects-v2 \
    --bucket "$S3_BUCKET" \
    --prefix "$S3_PREFIX/" \
    --query "sort_by(Contents,&LastModified)[-1].Key" \
    --output text
}

if [ -z "$RESTORE_FILE" ] && [ -n "$RESTORE_S3_KEY" ]; then
  if [ -z "$S3_BUCKET" ]; then
    echo "[restore] S3_BUCKET is required when RESTORE_S3_KEY is set"
    exit 1
  fi
  RESTORE_FILE="$(download_from_s3 "$RESTORE_S3_KEY")"
fi

if [ -z "$RESTORE_FILE" ]; then
  RESTORE_FILE="$(pick_latest_local)"
fi

if [ -z "$RESTORE_FILE" ] && [ -n "$S3_BUCKET" ]; then
  latest_key="$(pick_latest_s3_key)"
  if [ "$latest_key" != "None" ] && [ -n "$latest_key" ]; then
    RESTORE_FILE="$(download_from_s3 "$latest_key")"
  fi
fi

if [ -z "$RESTORE_FILE" ]; then
  echo "[restore] no backup file found"
  exit 1
fi

INPUT_FILE="$RESTORE_FILE"
DECRYPTED_FILE=""
case "$RESTORE_FILE" in
  *.enc)
    if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
      echo "[restore] BACKUP_ENCRYPTION_KEY is required for encrypted backups"
      exit 1
    fi
    DECRYPTED_FILE="${BACKUP_DIR}/restore_$(date +%Y%m%d_%H%M%S).dump"
    openssl enc -d -aes-256-cbc -pbkdf2 \
      -in "$RESTORE_FILE" \
      -out "$DECRYPTED_FILE" \
      -pass env:BACKUP_ENCRYPTION_KEY
    INPUT_FILE="$DECRYPTED_FILE"
    ;;
esac

echo "[restore] restoring from $INPUT_FILE"
PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -h "$POSTGRES_HOST" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  "$INPUT_FILE"

if [ -n "$DECRYPTED_FILE" ] && [ -f "$DECRYPTED_FILE" ]; then
  rm -f "$DECRYPTED_FILE"
fi

echo "[restore] completed"
