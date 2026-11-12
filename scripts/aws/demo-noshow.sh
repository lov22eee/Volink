#!/bin/bash
# 시연용 불참 3번 계정 (2026-11-12, for the week-7 demo only). Run on the server from /opt/volink:
#   sudo bash scripts/aws/demo-noshow.sh <참가자 이메일> <비밀번호>
# The participant is signed up (or, if the e-mail already exists, logged in with that password). A helper organizer
# account makes three short activities titled "[시연]", the participant applies and is approved, then the three are
# moved into the past with attendance opened and no check-in, so the server's own 1-minute scheduler records three
# 불참 and the 14일 신청 제한 the normal way. Afterwards: do not open the app with this account until the demo
# (the warning sheet shows once). Nothing else on the server is touched.
set -euo pipefail
cd "$(dirname "$0")/../.."
EMAIL="${1:-}"; PASS="${2:-}"
if [ -z "$EMAIL" ] || [ -z "$PASS" ]; then echo "사용법: sudo bash scripts/aws/demo-noshow.sh <참가자 이메일> <비밀번호>" >&2; exit 1; fi
API=http://127.0.0.1:8080
set -a; . ./.env; set +a
sql() { docker compose exec -T -e MYSQL_PWD="$MYSQL_PASSWORD" db mysql --default-character-set=utf8mb4 -u "$MYSQL_USER" "$MYSQL_DATABASE" -N -e "$1"; }
json() { python3 -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }
post() {
  local auth=()
  [ -n "${3:-}" ] && auth=(-H "Authorization: Bearer $3")
  curl -s -X POST "$API$1" -H 'Content-Type: application/json' "${auth[@]}" -d "$2"
}
put() { curl -s -X PUT "$API$1" -H 'Content-Type: application/json' -H "Authorization: Bearer $3" -d "$2" >/dev/null; }
login() { post /api/auth/login "{\"email\":\"$1\",\"password\":\"$2\"}" | json accessToken; }
day() { TZ=Asia/Seoul date -d "+$1 day" +%F; }
kst() { TZ=Asia/Seoul date -d "$1 minutes" '+%F %T'; }

echo "1) 참가자 계정"
post /api/auth/signup "{\"memberType\":\"GENERAL\",\"name\":\"시연참가자\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"birthDate\":\"2000-01-01\",\"interests\":[\"환경\"],\"agreedNotice\":true}" >/dev/null || true
USER_TOKEN=$(login "$EMAIL" "$PASS")
[ -n "$USER_TOKEN" ] || { echo "참가자로 로그인하지 못했어요. 이미 있는 이메일이면 그 계정의 비밀번호를 넣어 주세요." >&2; exit 1; }

echo "2) 모집자 도우미 계정"
HOST="demo-host-$(date +%s)@example.com"
post /api/auth/signup "{\"memberType\":\"GENERAL\",\"name\":\"시연모집자\",\"email\":\"$HOST\",\"password\":\"$PASS\",\"birthDate\":\"1995-01-01\",\"interests\":[\"환경\"],\"agreedNotice\":true}" >/dev/null
HOST_TOKEN=$(login "$HOST" "$PASS")
put /api/community/me "{\"nickname\":\"시연모집$(date +%S)\",\"agree\":true}" "$HOST_TOKEN"

echo "3) 모집글 3개 → 신청 → 승인"
IDS=""
i=0
for TITLE in "[시연] 공원 산책로 쓰레기 줍기" "[시연] 도서관 책 정리 돕기" "[시연] 마을 꽃길 가꾸기"; do
  i=$((i + 1))
  ID=$(post /api/activities "{\"activityType\":\"GENERAL\",\"title\":\"$TITLE\",\"category\":\"환경\",\"placeId\":1,\"date\":\"$(day $((2 + i)))\",\"time\":\"10:00\",\"capacity\":5,\"durationMinutes\":60,\"description\":\"시연용으로 만든 활동이에요. 공원 산책로를 천천히 걸으며 쓰레기를 함께 주워요.\",\"safetyConfirmed\":true}" "$HOST_TOKEN" | json id)
  [ -n "$ID" ] || { echo "모집글을 만들지 못했어요." >&2; exit 1; }
  post "/api/activities/$ID/participations" '{}' "$USER_TOKEN" >/dev/null
  PID=$(sql "SELECT id FROM participations WHERE activity_id=$ID ORDER BY id DESC LIMIT 1" | tr -d '[:space:]')
  post "/api/participations/$PID/approve" '{}' "$HOST_TOKEN" >/dev/null
  IDS="${IDS:+$IDS,}$ID"
  # Days apart in the past (4, 8, 12 days ago), attendance opened, never checked in.
  sql "UPDATE activities SET starts_at='$(kst $((-i * 5760 - 120)))', ends_at='$(kst $((-i * 5760 - 60)))', checkin_opened_at='$(kst $((-i * 5760 - 130)))', status='IN_PROGRESS' WHERE id=$ID"
done

echo "4) 서버가 불참으로 기록할 때까지 기다려요 (1~2분)"
for _ in $(seq 1 36); do
  N=$(sql "SELECT COUNT(*) FROM participations WHERE activity_id IN ($IDS) AND status='NO_SHOW'" | tr -d '[:space:]')
  [ "$N" = "3" ] && break
  sleep 5
done
echo "불참 ${N}번 기록됨 · 제한: $(sql "SELECT COUNT(*) FROM sanctions s JOIN users u ON u.id=s.user_id WHERE u.email='$EMAIL' AND s.source='NOSHOW' AND s.revoked_at IS NULL" | tr -d '[:space:]')건"
echo "완료. 시연 전까지 이 계정으로 앱을 열지 마세요 (경고 시트는 한 번만 떠요)."
