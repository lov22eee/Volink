#!/bin/bash
# 최종 발표 시연 준비 (2026-11-22). Run on the server from /opt/volink, the day before the demo:
#   sudo bash scripts/aws/demo-tomorrow.sh <참가자 이메일> <참가자 비밀번호> <모집자 이메일> <모집자 비밀번호> [장소 검색어]
# - 모집자 계정: signed up if it does not exist (개인 회원), allowed to post for 7 days without the phone step.
# - 활동 A (신청 시연용): 3일 뒤 10:00, 자동 승인 꺼짐 — the participant applies on stage and the organizer approves.
# - 활동 B (출석 시연용): made for 2 days later (an activity must start 24 h ahead), the participant applies (자동 승인 켬 →
#   확정), a question and its answer go in 소식, then B is moved to TOMORROW 14:00~17:00 here in the database.
#   [출석 시작] opens from 13:30 and 체크인 works until 16:30 (30 minutes before the end), whatever the slot of the talk.
# - The place: the first Kakao result for [장소 검색어] (where the talk is: 출석 needs the participant within 200 m), or else the
#   first admin place with coordinates. A post the place check sends to 운영자 검토 is opened here (demo only).
set -euo pipefail
cd "$(dirname "$0")/../.."
P_EMAIL="${1:-}"; P_PASS="${2:-}"; H_EMAIL="${3:-}"; H_PASS="${4:-}"; WHERE="${5:-}"
if [ -z "$P_EMAIL" ] || [ -z "$P_PASS" ] || [ -z "$H_EMAIL" ] || [ -z "$H_PASS" ]; then
  echo "사용법: sudo bash scripts/aws/demo-tomorrow.sh <참가자 이메일> <참가자 비밀번호> <모집자 이메일> <모집자 비밀번호> [장소 검색어]" >&2; exit 1
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
login() { call POST /api/auth/login "{\"email\":\"$1\",\"password\":\"$2\"}" | json accessToken; }
day() { TZ=Asia/Seoul date -d "+$1 day" +%F; }
TOMORROW=$(day 1)

echo "1) 계정"
P=$(login "$P_EMAIL" "$P_PASS")
[ -n "$P" ] || { echo "참가자 계정으로 로그인하지 못했어요. 이메일·비밀번호를 확인해 주세요." >&2; exit 1; }
call POST /api/auth/signup "{\"memberType\":\"GENERAL\",\"name\":\"모집자\",\"email\":\"$H_EMAIL\",\"password\":\"$H_PASS\",\"birthDate\":\"1995-01-01\",\"interests\":[\"환경\"],\"agreedNotice\":true}" >/dev/null || true
H=$(login "$H_EMAIL" "$H_PASS")
[ -n "$H" ] || { echo "모집자 계정을 만들거나 로그인하지 못했어요(이미 있는 이메일이면 그 계정의 비밀번호를 넣어 주세요)." >&2; exit 1; }
# 1인 1계정 (V42): without a verified phone, 7 days like the accounts from before the change.
sql "UPDATE users SET phone_grace_until = GREATEST(COALESCE(phone_grace_until, NOW()), NOW() + INTERVAL 7 DAY) WHERE phone_hash IS NULL AND email IN ('$P_EMAIL', '$H_EMAIL')"

echo "2) 장소"
PLACE_JSON=""
if [ -n "$WHERE" ]; then
  # The same search as the app (Kakao, signed by the server): {"place": {...}} goes into the post as it is.
  PLACE_JSON=$(curl -s -G "$API/api/places/search" --data-urlencode "query=$WHERE" | python3 -c "import json,sys
try:
  items=json.load(sys.stdin).get('items') or []
  it=items[0]
  sys.stderr.write('   %s · %s · %s, %s\\n' % (it.get('name'), it.get('address') or it.get('area') or '', it.get('latitude'), it.get('longitude')))
  print('\"place\":'+json.dumps(it, ensure_ascii=False) if it.get('token') else '\"placeId\":%d' % (it.get('placeId') or it['id']))
except Exception: print('')")
  [ -n "$PLACE_JSON" ] || { echo "'$WHERE'(으)로 장소를 찾지 못했어요. 다른 검색어로 다시 실행해 주세요." >&2; exit 1; }
else
  PLACE=$(sql "SELECT id FROM demo_places WHERE latitude IS NOT NULL ORDER BY id LIMIT 1" | tr -d '[:space:]')
  [ -n "$PLACE" ] || { echo "좌표가 있는 장소가 없어요. 장소 검색어를 넣어 주세요." >&2; exit 1; }
  sql "SELECT CONCAT('   ', name, ' · ', COALESCE(area, ''), ' · ', latitude, ', ', longitude) FROM demo_places WHERE id = $PLACE"
  PLACE_JSON="\"placeId\":$PLACE"
fi

activity() { # title date time minutes autoApprove description
  call POST /api/activities "{\"activityType\":\"GENERAL\",\"title\":\"$1\",\"category\":\"환경\",$PLACE_JSON,\"meetingPoint\":\"정문 앞\",\"date\":\"$2\",\"time\":\"$3\",\"capacity\":5,\"durationMinutes\":$4,\"description\":\"$6\",\"safetyConfirmed\":true,\"difficulty\":\"EASY\",\"placeKind\":\"OUTDOOR\",\"newcomerOk\":true,\"autoApprove\":$5,\"youthOk\":true}" "$H"
}

echo "3) 활동 A (신청 시연용)"
A=$(activity "공원 화단 꽃 심기" "$(day 3)" "10:00" 120 false "공원 화단에 꽃모종을 함께 심어요. 장갑과 모종삽은 나눠 드려요." | json id)
[ -n "$A" ] || { echo "활동 A를 만들지 못했어요." >&2; exit 1; }

echo "4) 활동 B (출석 시연용)"
B=$(activity "공원 산책로 쓰레기 줍기" "$(day 2)" "14:00" 180 true "공원 산책로의 쓰레기를 함께 주워요. 집게와 봉투는 나눠 드려요." | json id)
[ -n "$B" ] || { echo "활동 B를 만들지 못했어요." >&2; exit 1; }
# A school or a street can be a place that goes to 운영자 검토 (DRAFT): opened here for the demo, with a note.
sql "UPDATE activities SET status = 'RECRUITING', review_note = '시연 준비 스크립트로 공개' WHERE id IN ($A, $B) AND status = 'DRAFT'"
call POST "/api/activities/$B/participations" '{}' "$P" >/dev/null
STATUS=$(sql "SELECT p.status FROM participations p JOIN users u ON u.id = p.user_id WHERE p.activity_id = $B AND u.email = '$P_EMAIL'" | tr -d '[:space:]')
[ "$STATUS" = "CONFIRMED" ] || { echo "참가자가 활동 B에 확정되지 않았어요(상태: ${STATUS:-없음})." >&2; exit 1; }
Q=$(call POST "/api/activities/$B/questions" '{"body":"주차할 곳이 있을까요?","privately":false}' "$P" | json id)
[ -n "$Q" ] && call POST "/api/activity-posts/$Q/answer" '{"body":"공원 공영주차장을 이용해 주세요."}' "$H" >/dev/null
# 24 h ahead is the rule for new posts; the demo needs B tomorrow, so only its time is moved here.
sql "UPDATE activities SET starts_at = '$TOMORROW 14:00:00', ends_at = '$TOMORROW 17:00:00' WHERE id = $B"

echo
echo "완료"
sql "SELECT CONCAT('   ', id, ' · ', title, ' · ', status, ' · ', starts_at, ' ~ ', TIME(ends_at)) FROM activities WHERE id IN ($A, $B) ORDER BY starts_at DESC"
echo "   내일 13:30이 지나면 모집자 폰에서 '공원 산책로 쓰레기 줍기' → 출석 → [출석 시작]을 눌러 두세요(16:30까지 체크인)."
