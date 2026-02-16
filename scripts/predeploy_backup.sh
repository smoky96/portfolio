#!/usr/bin/env sh
set -eu
umask 077

usage() {
  cat <<'EOF'
Usage:
  ./scripts/predeploy_backup.sh [options]

Options:
  --database-url <url>   PostgreSQL connection URL (default: DATABASE_URL env)
  --backup-dir <dir>     Backup output directory (default: $HOME/portfolio-backups)
  --keep-last <count>    Keep the most recent backup files (default: 14)
  --prefix <name>        Backup filename prefix (default: portfolio_predeploy)
  --no-encrypt           Disable encryption even when BACKUP_ENCRYPTION_KEY is set
  -h, --help             Show this help

Environment:
  DATABASE_URL           PostgreSQL URL used when --database-url is not provided
  BACKUP_ENCRYPTION_KEY  If set, output is encrypted as .dump.enc via openssl
EOF
}

DATABASE_URL_INPUT="${DATABASE_URL:-}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/portfolio-backups}"
KEEP_COUNT="${BACKUP_KEEP_COUNT:-14}"
FILE_PREFIX="${BACKUP_FILE_PREFIX:-portfolio_predeploy}"
NO_ENCRYPT="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --database-url)
      DATABASE_URL_INPUT="$2"
      shift 2
      ;;
    --backup-dir)
      BACKUP_DIR="$2"
      shift 2
      ;;
    --keep-last)
      KEEP_COUNT="$2"
      shift 2
      ;;
    --prefix)
      FILE_PREFIX="$2"
      shift 2
      ;;
    --no-encrypt)
      NO_ENCRYPT="true"
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[backup] unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$DATABASE_URL_INPUT" ]; then
  echo "[backup] DATABASE_URL is required (env or --database-url)." >&2
  exit 1
fi

PG_DUMP_URL="$DATABASE_URL_INPUT"
case "$PG_DUMP_URL" in
  postgresql+psycopg2://*)
    PG_DUMP_URL="postgresql://${PG_DUMP_URL#postgresql+psycopg2://}"
    ;;
  postgres+psycopg2://*)
    PG_DUMP_URL="postgres://${PG_DUMP_URL#postgres+psycopg2://}"
    ;;
esac

case "$KEEP_COUNT" in
  ''|*[!0-9]*)
    echo "[backup] --keep-last must be a non-negative integer." >&2
    exit 1
    ;;
esac

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[backup] pg_dump is required but not found in PATH." >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "[backup] pg_restore is required but not found in PATH." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TS="$(date -u +%Y%m%d_%H%M%S)"
RAW_FILE="$BACKUP_DIR/${FILE_PREFIX}_${TS}.dump"
FINAL_FILE="$RAW_FILE"

echo "[backup] creating dump: $RAW_FILE"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  "$PG_DUMP_URL" \
  -f "$RAW_FILE"

echo "[backup] verifying dump integrity"
pg_restore --list "$RAW_FILE" >/dev/null

if [ "$NO_ENCRYPT" != "true" ] && [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "[backup] openssl is required for encryption but not found in PATH." >&2
    exit 1
  fi
  FINAL_FILE="${RAW_FILE}.enc"
  echo "[backup] encrypting dump: $FINAL_FILE"
  openssl enc -aes-256-cbc -pbkdf2 -salt \
    -in "$RAW_FILE" \
    -out "$FINAL_FILE" \
    -pass env:BACKUP_ENCRYPTION_KEY
  rm -f "$RAW_FILE"
fi

if [ "$KEEP_COUNT" -gt 0 ]; then
  old_files="$(ls -1t "$BACKUP_DIR"/"${FILE_PREFIX}"_*.dump* 2>/dev/null | awk "NR>${KEEP_COUNT}")"
  if [ -n "$old_files" ]; then
    echo "$old_files" | while IFS= read -r old_file; do
      [ -z "$old_file" ] && continue
      echo "[backup] pruning old backup: $old_file"
      rm -f "$old_file"
    done
  fi
fi

echo "[backup] completed: $FINAL_FILE"
