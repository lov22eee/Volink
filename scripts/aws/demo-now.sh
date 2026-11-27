#!/bin/bash
# 출석 흐름 녹화용 모집글 (2026-11-27). Run on the server from /opt/volink, right before recording:
#   sudo bash scripts/aws/demo-now.sh '<모집자 이메일>' '<모집자 비밀번호>' '[시작 시각 HH:MM]' '[장소 검색어]'
# One ordinary-looking post by the organizer: "창동 골목 쓰레기 줍기", 자동 승인 켬, 정원 1, a 공지 in 소식.
#   Starts at [시작 시각] (default: about 10 minutes from now, or tomorrow 09:00 late in the evening) for 3 hours
#   (shorter if it would end after 22:00).
#   [출석 시작] works from 30 minutes before the start, so the organizer can open 출석 at once;
#   the participant can apply (or join after the start, 진행 중 합류) and check in until 30 minutes before the end.
# Place: the first Kakao result of [장소 검색어] (default: 창동 화이트365; 출석 needs the participant within 200 m).
# A post must start 24 h ahead, so it is made 2 days later at the same time and moved to today here in the database.
set -euo pipefail
cd "$(dirname "$0")/../.."
H_EMAIL="${1:-}"; H_PASS="${2:-}"; START="${3:-}"; WHERE="${4:-}"
if [ -z "$H_EMAIL" ] || [ -z "$H_PASS" ]; then
  echo "사용법: sudo bash scripts/aws/demo-now.sh '<모집자 이메일>' '<모집자 비밀번호>' '[시작 시각 HH:MM]' '[장소 검색어]'" >&2; exit 1
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

# Start and length (Korea time). Default: the next 10-minute mark at least 10 minutes from now; when that no longer
# fits today (1 hour before 22:00), tomorrow 09:00. A given HH:MM is today while its 체크인 is still open, else tomorrow.
NOW=$(( 10#$(TZ=Asia/Seoul date +%H) * 60 + 10#$(TZ=Asia/Seoul date +%M) ))
DAY=0
if [ -n "$START" ]; then
  [[ "$START" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "시작 시각은 HH:MM으로 넣어 주세요 (예: 10:30)." >&2; exit 1; }
  S=$(( 10#${START%%:*} * 60 + 10#${START##*:} ))
  [ "$S" -ge 360 ] || { echo "시작 시각은 06:00 이후로 넣어 주세요." >&2; exit 1; }
else
  S=$(( (NOW + 10 + 9) / 10 * 10 ))
  [ "$S" -ge 360 ] || S=360
  [ $(( 1320 - S )) -ge 60 ] || { S=540; DAY=1; }
fi
LEN=$(( 1320 - S )); [ "$LEN" -gt 180 ] && LEN=180
[ "$LEN" -ge 60 ] || { echo "22:00 전에 1시간 이상 할 수 없는 시각이에요. 더 이른 시작 시각을 넣어 주세요." >&2; exit 1; }
[ -n "$START" ] && [ "$NOW" -ge $(( S + LEN - 30 )) ] && DAY=1
TIME=$(printf '%02d:%02d' $((S / 60)) $((S % 60)))
END=$(printf '%02d:%02d' $(((S + LEN) / 60)) $(((S + LEN) % 60)))
TODAY=$(TZ=Asia/Seoul date -d "+$DAY day" +%F)
LATER=$(TZ=Asia/Seoul date -d "+$((DAY + 2)) day" +%F)

echo "1) 모집자 로그인"
H=$(login "$H_EMAIL" "$H_PASS")
[ -n "$H" ] || { echo "모집자 계정으로 로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요." >&2; exit 1; }

echo "2) 장소"
place() { curl -s -G "$API/api/places/search" --data-urlencode "query=$1" | python3 -c "import json,sys
try:
  items=json.load(sys.stdin).get('items') or []
  it=items[0]
  sys.stderr.write('   %s · %s · %s, %s\\n' % (it.get('name'), it.get('address') or it.get('area') or '', it.get('latitude'), it.get('longitude')))
  print('\"place\":'+json.dumps(it, ensure_ascii=False) if it.get('token') else '\"placeId\":%d' % (it.get('placeId') or it['id']))
except Exception: print('')"; }
PLACE_JSON=""
if [ -n "$WHERE" ]; then QUERIES=("$WHERE"); else QUERIES=("창동 화이트365" "화이트365" "창동 623-6"); fi
for q in "${QUERIES[@]}"; do
  PLACE_JSON=$(place "$q")
  [ -n "$PLACE_JSON" ] && { echo "   검색어: $q"; break; }
done
[ -n "$PLACE_JSON" ] || { echo "장소를 찾지 못했어요. 네 번째 칸에 다른 검색어를 넣어 다시 실행해 주세요." >&2; exit 1; }

echo "3) 모집글"
B=$(call POST /api/activities "{\"activityType\":\"GENERAL\",\"title\":\"창동 골목 쓰레기 줍기\",\"category\":\"환경\",$PLACE_JSON,\"meetingPoint\":\"화이트365 앞\",\"date\":\"$LATER\",\"time\":\"$TIME\",\"capacity\":1,\"durationMinutes\":$LEN,\"description\":\"창동 골목과 주변 길의 쓰레기를 함께 주워요. 집게와 봉투는 나눠 드려요. 처음 오셔도 괜찮아요.\",\"supplies\":[{\"name\":\"장갑\",\"provided\":false},{\"name\":\"집게\",\"provided\":false},{\"name\":\"봉투\",\"provided\":false}],\"safetyConfirmed\":true,\"difficulty\":\"EASY\",\"placeKind\":\"OUTDOOR\",\"newcomerOk\":true,\"autoApprove\":true,\"youthOk\":true}" "$H" | json id)
[ -n "$B" ] || { echo "모집글을 만들지 못했어요." >&2; exit 1; }
# A street or an unnamed spot can be a place that goes to 운영자 검토 (DRAFT): opened here for the recording.
sql "UPDATE activities SET status = 'RECRUITING', review_note = '녹화 준비 스크립트로 공개' WHERE id = $B AND status = 'DRAFT'"
call POST "/api/activities/$B/notices" '{"body":"화이트365 앞에서 모여요. 도착하면 모집자 화면의 출석 QR을 찍어 주세요."}' "$H" >/dev/null
sql "UPDATE activities SET starts_at = '$TODAY $TIME:00', ends_at = '$TODAY $END:00' WHERE id = $B"

echo
echo "완료"
sql "SELECT CONCAT('   ', id, ' · ', title, ' · ', status, ' · ', starts_at, ' ~ ', TIME(ends_at)) FROM activities WHERE id = $B"
OPEN=$(printf '%02d:%02d' $(((S - 30) / 60)) $(((S - 30) % 60)))
LAST=$(printf '%02d:%02d' $(((S + LEN - 30) / 60)) $(((S + LEN - 30) % 60)))
echo "   $TODAY $OPEN부터 모집자 폰에서 이 글 → 출석 → [출석 시작]. 신청·합류·체크인은 $LAST까지예요."
