#!/usr/bin/env bash
# Demo server only: show that passwords are stored as BCrypt hashes, never as plain text.
# Usage on the server: sudo bash /opt/volink/scripts/aws/show-users.sh
# Prints only the start of each hash ($2a$10$ + salt) so the full hash never appears on a projector.
set -euo pipefail
cd /opt/volink
set -a; . ./.env; set +a
docker compose exec -T -e MYSQL_PWD="$MYSQL_PASSWORD" db mysql -t -u "$MYSQL_USER" "$MYSQL_DATABASE" -e \
  "SELECT email, role, member_type, CONCAT(LEFT(password_hash, 29), '...') AS password_hash_start, CHAR_LENGTH(password_hash) AS hash_length
   FROM users WHERE email NOT LIKE '%@demo.volink.kr' ORDER BY id DESC LIMIT 10;
   SELECT COUNT(*) AS refresh_tokens_stored_as_sha256 FROM refresh_tokens;"
