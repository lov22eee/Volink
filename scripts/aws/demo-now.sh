#!/bin/bash
# 발표 직전 (2026-11-22). Run on the server from /opt/volink right before the talk:
#   sudo bash scripts/aws/demo-now.sh [분, 기본 20]
# The post made by demo-tomorrow.sh starts N minutes from now (Korean time) for 2 hours: 신청 works until the start and
# [출석 시작] works from 30 minutes before it, so on stage the participant can apply, read 소식 and check in by QR.
# Running it again moves it again (e.g. when the turn comes later than planned). Applications already made stay.
set -euo pipefail
cd "$(dirname "$0")/../.."
MIN="${1:-20}"
case "$MIN" in ''|*[!0-9]*) echo "분은 숫자로 넣어 주세요(예: 20)." >&2; exit 1 ;; esac
[ "$MIN" -ge 1 ] && [ "$MIN" -le 29 ] || { echo "1~29분 사이로 넣어 주세요(30분 전부터 출석을 열 수 있어요)." >&2; exit 1; }
[ -s .demo-activity ] || { echo "먼저 scripts/aws/demo-tomorrow.sh로 모집글을 만들어 주세요." >&2; exit 1; }
B=$(tr -d '[:space:]' < .demo-activity)
set -a; . ./.env; set +a
sql() { docker compose exec -T -e MYSQL_PWD="$MYSQL_PASSWORD" db mysql --default-character-set=utf8mb4 -u "$MYSQL_USER" "$MYSQL_DATABASE" -N -e "$1"; }
START=$(TZ=Asia/Seoul date -d "+$MIN min" '+%F %H:%M:00')
END=$(TZ=Asia/Seoul date -d "+$((MIN + 120)) min" '+%F %H:%M:00')
# 22:00 is the latest end for a post; a demo in the evening keeps the 2 hours anyway (only the date check knows the rule).
sql "UPDATE activities SET starts_at = '$START', ends_at = '$END', status = 'RECRUITING' WHERE id = $B AND status IN ('RECRUITING', 'IN_PROGRESS')"
sql "SELECT CONCAT('   ', id, ' · ', title, ' · ', status, ' · ', starts_at, ' ~ ', TIME(ends_at)) FROM activities WHERE id = $B"
echo "   지금 신청할 수 있고, 모집자 폰에서 [출석 시작]을 바로 누를 수 있어요."
