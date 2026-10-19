#!/usr/bin/env bash
# Runs on the EC2 server as root. First boot (from launch.sh user data) and every update:
#   sudo bash /opt/volink/scripts/aws/server-setup.sh
# Pulls /etc/volink/ref, builds backend + frontend, runs MySQL (Docker), API (systemd), Nginx, HTTPS.
# Secrets are generated on the server into /opt/volink/.env (root only) and never printed.
set -euo pipefail
DOMAIN=$(cat /etc/volink/domain)
REF=$(cat /etc/volink/ref)
NODE_VERSION=v22.22.0
APP=/opt/volink
export DEBIAN_FRONTEND=noninteractive HOME=/root
step() { echo "== $(date '+%F %T') $*"; }

# Update the checkout first, then run the fresh copy (bash must not read a file that git is replacing).
if [ -z "${VOLINK_FRESH:-}" ]; then
  git -C "$APP" fetch -q origin "$REF"
  git -C "$APP" checkout -q -B "$REF" "origin/$REF"
  cp "$APP/scripts/aws/server-setup.sh" /tmp/volink-setup.sh
  VOLINK_FRESH=1 exec bash /tmp/volink-setup.sh
fi

step "packages"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
apt-get update -q
apt-get install -yq git curl unzip python3 openjdk-21-jdk-headless docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
systemctl enable --now docker
if [ "$(/opt/node/bin/node -v 2>/dev/null)" != "$NODE_VERSION" ]; then
  tmp=$(mktemp -d)
  file="node-$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSLo "$tmp/$file" "https://nodejs.org/dist/$NODE_VERSION/$file"
  curl -fsSLo "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf /opt/node && mkdir -p /opt/node && tar -xJf "$tmp/$file" -C /opt/node --strip-components=1
  rm -rf "$tmp"
fi
export PATH="/opt/node/bin:$PATH"

step "source $REF @ $(git -C "$APP" rev-parse --short HEAD)"
cd "$APP"

step "env + database"
bash scripts/setup-env.sh
grep -q '^AUTH_COOKIE_SECURE=' .env || echo 'AUTH_COOKIE_SECURE=true' >> .env
chmod 600 .env
docker compose up -d --wait db

step "backend build"
(cd backend && ./mvnw -q -B -DskipTests package)
id volink >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin volink
mkdir -p /opt/volink-app
install -m 644 backend/target/volink-api-*.jar /opt/volink-app/volink-api.jar
cat > /etc/systemd/system/volink-api.service <<UNIT
[Unit]
Description=Volink API
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=volink
EnvironmentFile=$APP/.env
# dev profile = demo server: creates the 11 demo accounts from DEMO_ACCOUNT_PASSWORD in .env.
Environment=SPRING_PROFILES_ACTIVE=dev
Environment=DB_HOST=127.0.0.1
ExecStart=/usr/bin/java -Xms256m -Xmx512m -jar /opt/volink-app/volink-api.jar
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable volink-api
systemctl restart volink-api

step "frontend build"
# Kakao Maps JavaScript key (public, domain-restricted). Without it the site shows a simple position sketch.
if [ -s /etc/volink/kakao_js_key ]; then export VITE_KAKAO_JS_KEY="$(tr -d '[:space:]' < /etc/volink/kakao_js_key)"; fi
(cd frontend && npm ci --no-audit --no-fund && npm run build)
rm -rf /var/www/volink && mkdir -p /var/www/volink && cp -r frontend/dist/. /var/www/volink/

step "nginx + https"
site=/etc/nginx/sites-available/volink
common="
    root /var/www/volink;
    index index.html;
    client_max_body_size 1m;
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location = /actuator/health { proxy_pass http://127.0.0.1:8080; }
    location / { try_files \$uri /index.html; }"
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  cat > "$site" <<NGINX
server { listen 80; server_name $DOMAIN; return 301 https://\$host\$request_uri; }
server {
    listen 443 ssl;
    server_name $DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;$common
}
NGINX
else
  printf 'server {\n    listen 80;\n    server_name %s;%s\n}\n' "$DOMAIN" "$common" > "$site"
fi
ln -sf "$site" /etc/nginx/sites-enabled/volink
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || echo "WARN: HTTPS 인증서 발급 실패. http://$DOMAIN 로는 접속됩니다. 나중에 이 스크립트를 다시 실행하세요."
fi

step "check"
for _ in $(seq 1 60); do
  curl -fs http://127.0.0.1:8080/actuator/health >/dev/null && break
  sleep 3
done
curl -fs http://127.0.0.1:8080/actuator/health && echo
step "DONE https://$DOMAIN"
