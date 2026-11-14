#!/bin/bash
# 시연 준비 한 번에 (2026-11-14, for the week-7 demo with one phone and one account). Run on the server from /opt/volink:
#   sudo bash scripts/aws/demo-ready.sh <시연 계정 이메일> <비밀번호>
# The account is signed up if it does not exist (or logged in with that password). Then, on that one account:
#   1) 신고 경고 1회 — a helper reports the account's community post and a temporary admin accepts it (the post is hidden),
#   2) 불참 3회 — the same steps as demo-noshow.sh (14일 신청 제한),
#   3) a post by someone else to report during the demo, and the account's own recruiting activity for 봉사 홍보.
# Everything made here is titled "[시연]". The helper accounts stay (example.com addresses); the temporary admin is turned
# back into a member at the end. Do not open the app with this account until the demo: each warning sheet shows once.
set -euo pipefail
cd "$(dirname "$0")/../.."
EMAIL="${1:-}"; PASS="${2:-}"
if [ -z "$EMAIL" ] || [ -z "$PASS" ]; then echo "사용법: sudo bash scripts/aws/demo-ready.sh <이메일> <비밀번호>" >&2; exit 1; fi
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
signup() { call POST /api/auth/signup "{\"memberType\":\"GENERAL\",\"name\":\"$2\",\"email\":\"$1\",\"password\":\"$3\",\"birthDate\":\"$4\",\"interests\":[\"환경\"],\"agreedNotice\":true}" >/dev/null || true; }
day() { TZ=Asia/Seoul date -d "+$1 day" +%F; }
STAMP=$(date +%s)
HELPER_PASS="Demo${STAMP}a1"

echo "1) 시연 계정"
signup "$EMAIL" "시연참가자" "$PASS" "2000-01-01"
ME=$(login "$EMAIL" "$PASS")
[ -n "$ME" ] || { echo "시연 계정으로 로그인하지 못했어요. 이미 있는 이메일이면 그 계정의 비밀번호를 넣어 주세요." >&2; exit 1; }
call PUT /api/community/me "{\"nickname\":\"초록손${STAMP: -5}\",\"agree\":true}" "$ME" >/dev/null || true

echo "2) 도우미 계정 (신고하는 사람 · 임시 관리자)"
HELPER="demo-helper-$STAMP@example.com"; ADMIN="demo-admin-$STAMP@example.com"
signup "$HELPER" "시연도우미" "$HELPER_PASS" "1998-01-01"
signup "$ADMIN" "시연관리" "$HELPER_PASS" "1990-01-01"
sql "UPDATE users SET role='ADMIN' WHERE email='$ADMIN'"
H=$(login "$HELPER" "$HELPER_PASS"); A=$(login "$ADMIN" "$HELPER_PASS")
[ -n "$H" ] && [ -n "$A" ] || { echo "도우미 계정을 만들지 못했어요." >&2; exit 1; }
call PUT /api/community/me "{\"nickname\":\"이웃${STAMP: -5}\",\"agree\":true}" "$H" >/dev/null || true

echo "3) 신고 경고 1회"
MINE=$(call POST /api/community/posts '{"category":"FREE","title":"[시연] 주말에 같이 봉사 가요","body":"[시연] 이번 주말 공원 정리 같이 가실 분 찾아요. 처음이어도 괜찮아요."}' "$ME" | json id)
[ -n "$MINE" ] || { echo "시연 계정의 글을 만들지 못했어요(글쓰기 제한 중일 수 있어요)." >&2; exit 1; }
REPORT=$(call POST /api/reports "{\"targetType\":\"POST\",\"targetId\":$MINE,\"reason\":\"SPAM\",\"description\":\"[시연] 같은 내용을 여러 번 올렸어요\"}" "$H" | json id)
[ -n "$REPORT" ] || REPORT=$(sql "SELECT id FROM reports WHERE target_type='POST' AND target_id=$MINE ORDER BY id DESC LIMIT 1" | tr -d '[:space:]')
call POST "/api/admin/reports/$REPORT/decision" '{"decision":"ACCEPT","hide":true,"reason":"[시연] 같은 글을 반복해서 올린 것으로 확인했어요."}' "$A" >/dev/null

echo "4) 시연 때 신고할 다른 사람 글 · 내 모집글"
call POST /api/community/posts '{"category":"FREE","title":"[시연] 봉사 같이 하실 분 연락 주세요","body":"[시연] 이번 주 토요일 오전에 함께하실 분 댓글 남겨 주세요."}' "$H" >/dev/null
call POST /api/activities "{\"activityType\":\"GENERAL\",\"title\":\"[시연] 공원 산책로 정리 함께해요\",\"category\":\"환경\",\"placeId\":1,\"date\":\"$(day 6)\",\"time\":\"10:00\",\"capacity\":5,\"durationMinutes\":120,\"description\":\"[시연] 편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 주워요. 집게와 봉투는 나눠 드려요.\",\"safetyConfirmed\":true}" "$ME" >/dev/null

echo "5) 임시 관리자 권한 거두기"
sql "UPDATE users SET role='USER' WHERE email='$ADMIN'"

echo "6) 불참 3회 (1~2분)"
bash scripts/aws/demo-noshow.sh "$EMAIL" "$PASS"

echo "완료: 신고 경고 1회 · 불참 3회 · 신고할 글 · 내 모집글 1개."
echo "시연 전까지 이 계정으로 앱을 열지 마세요 (경고 시트는 한 번씩만 떠요)."
