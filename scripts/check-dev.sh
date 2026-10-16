#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json, urllib.request, urllib.error
base='http://127.0.0.1:5173'
def get(path):
    with urllib.request.urlopen(base+path, timeout=10) as r:
        return json.load(r)
assert get('/actuator/health')['status']=='UP'
status=get('/api/project/status')
assert status['week']==7 and status['database']=='UP'
assert status['authenticationImplemented'] is True
catalog=get('/api/demo/catalog')
assert catalog['demo'] is True
assert len(catalog['places'])==3 and len(catalog['activities'])==3
assert len(catalog['personas'])==11
assert sum(p['role']=='INSTITUTION' for p in catalog['personas'])==2
assert all(a['activityType'] in ('GENERAL','INSTITUTION') for a in catalog['activities'])
assert sum(p['role']=='ORGANIZER' for p in catalog['personas'])==2
assert sum(p['role']=='PARTICIPANT' for p in catalog['personas'])==6
assert sum(p['role']=='ADMIN' for p in catalog['personas'])==1
assert all(2<=a['capacity']<=10 and 0<a['durationMinutes']<=180 for a in catalog['activities'])
assert all(p['coordinateStatus'] in ('UNVERIFIED', 'ENTERED') for p in catalog['places'])
assert isinstance(get('/api/activities'), list)
# Writing without a login token must be refused.
try:
    urllib.request.urlopen(urllib.request.Request(base+'/api/activities', data=b'{}', headers={'Content-Type': 'application/json'}, method='POST'), timeout=10)
    raise AssertionError('activity creation without login was accepted')
except urllib.error.HTTPError as e:
    assert e.code==401, e.code
with urllib.request.urlopen(base, timeout=10) as r:
    assert '<div id="root"></div>' in r.read().decode()
print('PASS: Vite -> Spring Boot -> MySQL; 3 places, 3 demo activities, 11 personas; public activity list and login-required writes verified.')
PY
