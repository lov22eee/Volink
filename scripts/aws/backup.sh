#!/usr/bin/env bash
# Daily backup of the database and the private evidence files; keeps 7 days. Run by /etc/cron.d/volink-backup.
#   sudo bash /opt/volink/scripts/aws/backup.sh
# Restore (careful: replaces the data):
#   gunzip -c /var/backups/volink/volink-YYYYmmdd-HHMMSS.sql.gz | sudo docker compose -f /opt/volink/compose.yaml exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root "$MYSQL_DATABASE"'
set -euo pipefail
APP="${APP:-/opt/volink}"
OUT="${OUT:-/var/backups/volink}"
EVIDENCE="${EVIDENCE:-/var/lib/volink/evidence}"
KEEP_DAYS="${KEEP_DAYS:-7}"
umask 077
mkdir -p "$OUT"
cd "$APP"
stamp="$(date -u +%Y%m%d-%H%M%S)"
file="$OUT/volink-$stamp.sql.gz"
# The root password stays inside the container environment; it is not printed or written to the backup folder.
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -u root --single-transaction --routines --triggers --no-tablespaces "$MYSQL_DATABASE"' | gzip > "$file.tmp"
mv "$file.tmp" "$file"
if [ -d "$EVIDENCE" ]; then tar -czf "$OUT/evidence-$stamp.tar.gz" -C "$EVIDENCE" .; fi
find "$OUT" -name 'volink-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find "$OUT" -name 'evidence-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup: $file ($(du -h "$file" | cut -f1))"
