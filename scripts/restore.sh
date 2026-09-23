#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_path="${1:?Usage: bash scripts/restore.sh backups/file.dump}"
[[ -f "$backup_path" ]] || { echo 'Backup file not found.'; exit 1; }
printf 'This replaces the current event database. Type RESTORE to continue: '
read -r confirmation
[[ "$confirmation" == RESTORE ]] || { echo 'Cancelled.'; exit 1; }
docker compose stop app
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists --no-owner --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$backup_path"
docker compose start app
