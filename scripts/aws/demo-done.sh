#!/bin/bash
# 발표 시연: 완료한 활동 하나 (2026-11-25). Run on the server from /opt/volink:
#   sudo bash scripts/aws/demo-done.sh '<모집자 이메일>' '<모집자 비밀번호>' '<참가자 이메일>' '[장소 검색어]'
# The organizer posts "공원 플로깅 함께해요" (as the app does; made 2 days ahead, the 24 h rule), then here in the database it
# becomes yesterday 10:00~12:00, FINISHED, with the participant checked in by QR and confirmed by the organizer: a VALID
# 활동 기록. So the participant can pick it in 커뮤니티 › 봉사후기 (완료한 활동) and see it in 내 활동 › 활동 기록.
set -euo pipefail
cd "$(dirname "$0")/../.."
H_EMAIL="${1:-}"; H_PASS="${2:-}"; P_EMAIL="${3:-}"; WHERE="${4:-}"
if [ -z "$H_EMAIL" ] || [ -z "$H_PASS" ] || [ -z "$P_EMAIL" ]; then
  echo "사용법: sudo bash scripts/aws/demo-done.sh '<모집자 이메일>' '<모집자 비밀번호>' '<참가자 이메일>' '[장소 검색어]'" >&2; exit 1
fi
API=http://127.0.0.1:8080
set -a; . ./.env; set +a
sql() { docker compose exec -T -e MYSQL_PWD="$MYSQL_PASSWORD" db mysql --default-character-set=utf8mb4 -u "$MYSQL_USER" "$MYSQL_DATABASE" -N -e "$1"; }
json() { python3 -c "import json,sys
try: print(json.load(sys.stdin).get('$1',''))
except Exception: print('')"; }
call() { # method path body [token]
  local auth=()
  [ -n "${4:-}" ] && auth=(-H "Authorization: Bearer $4")
  curl -s -X "$1" "$API$2" -H 'Content-Type: application/json' "${auth[@]}" -d "$3"
}
day() { TZ=Asia/Seoul date -d "$1 day" +%F; }

echo "1) 계정"
H=$(call POST /api/auth/login "{\"email\":\"$H_EMAIL\",\"password\":\"$H_PASS\"}" | json accessToken)
[ -n "$H" ] || { echo "모집자 계정으로 로그인하지 못했어요. 이메일·비밀번호를 확인해 주세요." >&2; exit 1; }
HID=$(sql "SELECT id FROM users WHERE email = '$H_EMAIL'" | tr -d '[:space:]')
PID=$(sql "SELECT id FROM users WHERE email = '$P_EMAIL'" | tr -d '[:space:]')
[ -n "$PID" ] || { echo "참가자 계정($P_EMAIL)을 찾지 못했어요." >&2; exit 1; }
[ "$PID" != "$HID" ] || { echo "모집자와 참가자는 다른 계정이어야 해요." >&2; exit 1; }

echo "2) 장소"
PLACE_JSON=""
if [ -n "$WHERE" ]; then
  PLACE_JSON=$(curl -s -G "$API/api/places/search" --data-urlencode "query=$WHERE" | python3 -c "import json,sys
try:
  it=(json.load(sys.stdin).get('items') or [])[0]
  sys.stderr.write('   %s · %s\\n' % (it.get('name'), it.get('address') or it.get('area') or ''))
  print('\"place\":'+json.dumps(it, ensure_ascii=False) if it.get('token') else '\"placeId\":%d' % (it.get('placeId') or it['id']))
except Exception: print('')")
fi
if [ -z "$PLACE_JSON" ]; then
  PLACE=$(sql "SELECT id FROM demo_places WHERE latitude IS NOT NULL ORDER BY id LIMIT 1" | tr -d '[:space:]')
  [ -n "$PLACE" ] || { echo "좌표가 있는 장소가 없어요. 장소 검색어를 넣어 주세요." >&2; exit 1; }
  PLACE_JSON="\"placeId\":$PLACE"
fi

echo "3) 활동 (어제 10:00~12:00, 완료)"
A=$(call POST /api/activities "{\"activityType\":\"GENERAL\",\"title\":\"공원 플로깅 함께해요\",\"category\":\"환경\",$PLACE_JSON,\"meetingPoint\":\"정문 앞\",\"date\":\"$(day +2)\",\"time\":\"10:00\",\"capacity\":5,\"durationMinutes\":120,\"description\":\"공원을 걸으며 쓰레기를 함께 주워요. 집게와 봉투는 나눠 드려요.\",\"safetyConfirmed\":true,\"difficulty\":\"EASY\",\"placeKind\":\"OUTDOOR\",\"newcomerOk\":true,\"autoApprove\":true,\"youthOk\":true}" "$H" | json id)
[ -n "$A" ] || { echo "활동을 만들지 못했어요." >&2; exit 1; }
Y=$(day -1)
sql "UPDATE activities SET starts_at = '$Y 10:00:00', ends_at = '$Y 12:00:00', status = 'FINISHED', checkin_opened_at = '$Y 09:40:00' WHERE id = $A"
sql "INSERT INTO participations(activity_id, user_id, status, updated_at) VALUES ($A, $PID, 'COMPLETED', '$Y 12:10:00')"
P=$(sql "SELECT id FROM participations WHERE activity_id = $A AND user_id = $PID" | tr -d '[:space:]')
sql "INSERT INTO check_ins(participation_id, method, within_radius, checked_by, checked_at) VALUES ($P, 'QR', TRUE, $PID, '$Y 09:55:00')"
C=$(sql "SELECT id FROM check_ins WHERE participation_id = $P" | tr -d '[:space:]')
sql "INSERT INTO activity_records(participation_id, check_in_id, confirmed_by, confirmed_at) VALUES ($P, $C, $HID, '$Y 12:10:00')"

echo
echo "완료"
sql "SELECT CONCAT('   ', a.id, ' · ', a.title, ' · ', a.status, ' · ', a.starts_at, ' ~ ', TIME(a.ends_at), ' · 참가자 ', p.status, ' · 기록 ', r.status) FROM activities a JOIN participations p ON p.activity_id = a.id JOIN activity_records r ON r.participation_id = p.id WHERE a.id = $A"
echo "   참가자 앱: 커뮤니티 › 글쓰기 › 봉사후기 › 함께한 봉사에서 '공원 플로깅 함께해요'를 고를 수 있어요."
