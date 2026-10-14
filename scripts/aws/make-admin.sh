#!/usr/bin/env bash
# Demo server only: promote an account that already signed up on the site to ADMIN.
# Usage on the server: sudo bash /opt/volink/scripts/aws/make-admin.sh someone@example.com
# The password stays whatever the person chose at signup (BCrypt hash); nothing is printed but email/role.
set -euo pipefail
email="${1:?사용법: make-admin.sh 이메일}"
case "$email" in *[!A-Za-z0-9@._+-]*) echo "이메일 형식을 확인하세요." >&2; exit 1 ;; esac
cd /opt/volink
set -a; . ./.env; set +a
docker compose exec -T -e MYSQL_PWD="$MYSQL_PASSWORD" db mysql -u "$MYSQL_USER" "$MYSQL_DATABASE" -e \
  "UPDATE users SET role = 'ADMIN', member_type = 'GENERAL' WHERE email = '$email';
   SELECT email, role FROM users WHERE email = '$email';"
echo "다시 로그인하면 관리자 메뉴가 보입니다. (가입하지 않은 이메일이면 위 목록이 비어 있습니다)"
