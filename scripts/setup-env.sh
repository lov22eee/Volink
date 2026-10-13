#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
# Creates the ignored .env, or adds only missing keys to an existing one. Existing values are never changed or printed.
python3 - <<'PY'
import base64, os, secrets
existing = {}
if os.path.exists('.env'):
    with open('.env') as f:
        existing = {line.split('=', 1)[0] for line in f if '=' in line and not line.startswith('#')}
values = {
    'MYSQL_DATABASE': 'volink',
    'MYSQL_USER': 'volink',
    'MYSQL_PASSWORD': secrets.token_hex(24),
    'MYSQL_ROOT_PASSWORD': secrets.token_hex(32),
    'MYSQL_PORT': '3307',
    'SERVER_PORT': '8080',
    # Week 3: JWT signing key and the local-only password for the 11 demo login accounts.
    'JWT_SECRET': base64.b64encode(secrets.token_bytes(32)).decode(),
    'DEMO_ACCOUNT_PASSWORD': 'Demo' + secrets.token_hex(8),
}
missing = [key for key in values if key not in existing]
if not missing:
    print('.env exists and is complete; preserving the current configuration.')
else:
    with open('.env', 'a') as f:
        for key in missing:
            f.write(f'{key}={values[key]}\n')
    os.chmod('.env', 0o600)
    print('Added to ignored .env (values not printed): ' + ', '.join(missing))
PY
