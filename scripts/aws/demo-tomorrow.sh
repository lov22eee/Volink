#!/bin/bash
# 최종 발표 시연 준비 (2026-11-22). Run on the server from /opt/volink, the evening before:
#   sudo bash scripts/aws/demo-tomorrow.sh '<모집자 이메일>' '<모집자 비밀번호>' '[장소 검색어]'
# One post by the organizer (개인 회원, 이름 박용빈; signed up if the e-mail is new, 7 days without the phone step):
#   "캠퍼스 산책로 쓰레기 줍기", 자동 승인 켬, 정원 1, TOMORROW 14:00~17:00, a 공지 in 소식. Nobody is signed in to it.
#   A post must start 24 h ahead, so it is made 2 days later and moved to tomorrow here in the database.
# On stage, whenever the talk is between 13:30 and 16:30: the participant applies (before 14:00) or joins (진행 중 합류,
# after 14:00) and is confirmed at once by 자동 승인; [출석 시작] works from 13:30 and 체크인 until 16:30.
# The place: the first Kakao result for [장소 검색어] (출석 needs the participant within 200 m), or else the first admin place
# with coordinates. A post the place check sends to 운영자 검토 is opened here (demo only).
set -euo pipefail
cd "$(dirname "$0")/../.."
H_EMAIL="${1:-}"; H_PASS="${2:-}"; WHERE="${3:-}"
if [ -z "$H_EMAIL" ] || [ -z "$H_PASS" ]; then
  echo "사용법: sudo bash scripts/aws/demo-tomorrow.sh '<모집자 이메일>' '<모집자 비밀번호>' '[장소 검색어]'" >&2; exit 1
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

echo "1) 모집자 계정"
call POST /api/auth/signup "{\"memberType\":\"GENERAL\",\"name\":\"박용빈\",\"email\":\"$H_EMAIL\",\"password\":\"$H_PASS\",\"birthDate\":\"1995-01-01\",\"interests\":[\"환경\"],\"agreedNotice\":true}" >/dev/null || true
H=$(login "$H_EMAIL" "$H_PASS")
[ -n "$H" ] || { echo "모집자 계정으로 로그인하지 못했어요(이미 있는 이메일이면 그 계정의 비밀번호를 넣어 주세요)." >&2; exit 1; }
sql "UPDATE users SET display_name = '박용빈' WHERE email = '$H_EMAIL'"
# 1인 1계정 (V42): without a verified phone, 7 days like the accounts from before the change.
sql "UPDATE users SET phone_grace_until = GREATEST(COALESCE(phone_grace_until, NOW()), NOW() + INTERVAL 7 DAY) WHERE phone_hash IS NULL AND email = '$H_EMAIL'"

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

echo "3) 모집글"
B=$(call POST /api/activities "{\"activityType\":\"GENERAL\",\"title\":\"캠퍼스 산책로 쓰레기 줍기\",\"category\":\"환경\",$PLACE_JSON,\"meetingPoint\":\"건물 정문 앞\",\"date\":\"$(day 2)\",\"time\":\"14:00\",\"capacity\":1,\"durationMinutes\":120,\"description\":\"캠퍼스 산책로의 쓰레기를 함께 주워요. 집게와 봉투는 나눠 드려요.\",\"safetyConfirmed\":true,\"difficulty\":\"EASY\",\"placeKind\":\"OUTDOOR\",\"newcomerOk\":true,\"autoApprove\":true,\"youthOk\":true}" "$H" | json id)
[ -n "$B" ] || { echo "모집글을 만들지 못했어요." >&2; exit 1; }
# A school or a street can be a place that goes to 운영자 검토 (DRAFT): opened here for the demo, with a note.
sql "UPDATE activities SET status = 'RECRUITING', review_note = '시연 준비 스크립트로 공개' WHERE id = $B AND status = 'DRAFT'"
call POST "/api/activities/$B/notices" '{"body":"건물 정문 앞에서 모여요. 집게와 봉투는 나눠 드려요."}' "$H" >/dev/null
TOMORROW=$(day 1)
sql "UPDATE activities SET starts_at = '$TOMORROW 14:00:00', ends_at = '$TOMORROW 17:00:00' WHERE id = $B"

echo
echo "완료"
sql "SELECT CONCAT('   ', id, ' · ', title, ' · ', status, ' · ', starts_at, ' ~ ', TIME(ends_at)) FROM activities WHERE id = $B"
echo "   내일 13:30이 지나면 모집자 폰에서 이 글 → 출석 → [출석 시작]을 눌러 두세요(16:30까지 신청·합류·체크인)."
