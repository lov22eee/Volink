#!/usr/bin/env bash
# Configure Maven for the cloud's existing HTTPS proxy and CA. No TLS checks are disabled.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .cache/maven
python3 - <<'PY'
from pathlib import Path
import os, urllib.parse, xml.etree.ElementTree as ET
proxy=os.getenv('HTTPS_PROXY') or os.getenv('https_proxy')
if proxy:
    url=urllib.parse.urlsplit(proxy)
    if url.username or url.password:
        raise SystemExit('Authenticated proxy needs supported Maven credential configuration; not copying credentials.')
    root=ET.Element('settings', xmlns='http://maven.apache.org/SETTINGS/1.2.0')
    node=ET.SubElement(ET.SubElement(root,'proxies'),'proxy')
    for key,value in {'id':'cloud-egress','active':'true','protocol':'http','host':url.hostname,'port':str(url.port or 80),'nonProxyHosts':'localhost|127.0.0.1'}.items():
        ET.SubElement(node,key).text=value
    ET.ElementTree(root).write('.cache/maven/settings.xml',encoding='utf-8',xml_declaration=True)
    print('Maven uses the existing cloud proxy; no proxy credentials stored.')
PY
if [ -n "${CODEX_PROXY_CERT:-}" ] && [ -f "$CODEX_PROXY_CERT" ]; then
  java_bin=$(readlink -f "$(command -v java)")
  java_root=$(dirname "$(dirname "$java_bin")")
  # This is a local copy of public CA certificates. The standard cacerts password is not a credential.
  cp "$java_root/lib/security/cacerts" .cache/maven/cloud-cacerts
  keytool -importcert -noprompt -trustcacerts -alias volink-cloud-proxy \
    -file "$CODEX_PROXY_CERT" -keystore .cache/maven/cloud-cacerts -storepass changeit >/dev/null
  echo 'Imported the supplied cloud CA into a local Java trust store; TLS verification remains enabled.'
fi
