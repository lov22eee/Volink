#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json, urllib.request
base='http://127.0.0.1:5173'
def get(path):
    with urllib.request.urlopen(base+path, timeout=10) as r:
        return json.load(r)
assert get('/actuator/health')['status']=='UP'
status=get('/api/project/status')
assert status['week']==1 and status['database']=='UP'
assert status['authenticationImplemented'] is False
catalog=get('/api/demo/catalog')
assert catalog['demo'] is True
assert len(catalog['places'])==3 and len(catalog['activities'])==3
assert len(catalog['personas'])==9
assert sum(p['role']=='ORGANIZER' for p in catalog['personas'])==2
assert sum(p['role']=='PARTICIPANT' for p in catalog['personas'])==6
assert sum(p['role']=='ADMIN' for p in catalog['personas'])==1
assert all(2<=a['capacity']<=10 and 0<a['durationMinutes']<=180 for a in catalog['activities'])
assert all(p['coordinateStatus']=='UNVERIFIED' for p in catalog['places'])
with urllib.request.urlopen(base, timeout=10) as r:
    assert '<div id="root"></div>' in r.read().decode()
print('PASS: Vite -> Spring Boot -> MySQL; 3 places, 3 demo activities, 9 personas; week-1 boundaries verified.')
PY
