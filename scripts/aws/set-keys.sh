#!/usr/bin/env bash
# Runs on the EC2 server as root:  sudo bash /opt/volink/scripts/aws/set-keys.sh
# Asks for the keys without showing them, saves them under /etc/volink (root only), then rebuilds the site.
# Press Enter to keep a key that is already saved. Keys are never printed or put in git.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "sudo 로 실행해 주세요."; exit 1; }
mkdir -p /etc/volink
ask() {
  local file=/etc/volink/$1 label=$2 value
  read -rsp "$label (그대로 두려면 Enter): " value; echo
  value=$(printf '%s' "$value" | tr -d '[:space:]')
  if [ -n "$value" ]; then install -m 600 /dev/null "$file"; printf '%s' "$value" > "$file"; echo "  저장했습니다."
  elif [ -s "$file" ]; then echo "  기존 키를 그대로 씁니다."
  else echo "  비어 있습니다 (이 기능은 꺼진 채로 동작합니다)."; fi
}
ask kakao_js_key  "카카오 JavaScript 키"
ask kakao_rest_key "카카오 REST API 키"
ask data_go_kr_key "공공데이터포털 일반 인증키 (Decoding)"
# Kakao / Google login (personal members). Kakao uses the REST API key above as its client id once
# "카카오 로그인" is turned on in Kakao Developers; register {site}/api/auth/oauth/kakao/callback there.
ask kakao_login_on "카카오 로그인 켜기: y 입력 (끄려면 n)"
ask kakao_login_secret "카카오 로그인 Client Secret (쓰지 않으면 Enter)"
ask google_client_id "구글 OAuth 클라이언트 ID"
ask google_client_secret "구글 OAuth 클라이언트 보안 비밀"
ask kakao_admin_key "카카오 Admin 키 (탈퇴 때 카카오 연결 끊기, 쓰지 않으면 Enter)"
ask oauth_redirect_base "사이트 주소 (예: https://volink.example.com, 끝에 / 없이)"
echo "사이트를 다시 만듭니다 (몇 분 걸립니다)."
exec bash /opt/volink/scripts/aws/server-setup.sh
