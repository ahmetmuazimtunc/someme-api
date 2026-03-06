#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup.sh — Daily PostgreSQL backup for someme_db
# Add to crontab: 0 2 * * * /home/someme/someme-api/scripts/backup.sh >> /var/log/someme-backup.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
DB_NAME="someme_db"
DB_USER="someme_user"
DB_HOST="127.0.0.1"
DB_PORT="5432"
BACKUP_DIR="/var/backups/someme"
KEEP_DAYS=7

# Load DB password from .env (keep credentials out of this script)
ENV_FILE="/home/someme/someme-api/.env"
if [[ -f "$ENV_FILE" ]]; then
  export $(grep -E '^(DATABASE_URL|PGPASSWORD)=' "$ENV_FILE" | xargs) 2>/dev/null || true
fi

# Extract password from DATABASE_URL if PGPASSWORD is not set directly
if [[ -z "${PGPASSWORD:-}" && -n "${DATABASE_URL:-}" ]]; then
  PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  export PGPASSWORD
fi

# ── Run backup ────────────────────────────────────────────────────────────────
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
FILENAME="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup of $DB_NAME..."

pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  "$DB_NAME" \
  | gzip -9 > "$FILENAME"

SIZE=$(du -sh "$FILENAME" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup written: $FILENAME ($SIZE)"

# ── Rotate old backups ────────────────────────────────────────────────────────
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Removing backups older than $KEEP_DAYS days..."
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete

REMAINING=$(ls "$BACKUP_DIR" | wc -l)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done. $REMAINING backup file(s) retained."
