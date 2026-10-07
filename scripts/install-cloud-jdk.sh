#!/usr/bin/env bash
# Debian cloud fallback: extract signed-repository JDK packages locally, without changing system files.
set -euo pipefail
cd "$(dirname "$0")/.."
arch=$(dpkg --print-architecture)
jdk_dir="$PWD/.tools/jdk/usr/lib/jvm/java-21-openjdk-$arch"
if [ -x "$jdk_dir/bin/javac" ]; then
  "$jdk_dir/bin/javac" -version
  exit 0
fi
if command -v javac >/dev/null && javac -version 2>&1 | grep -q '^javac 21'; then
  echo 'Java 21 JDK already installed.'
  exit 0
fi
if [ ! -f /usr/share/keyrings/debian-archive-keyring.gpg ]; then
  echo 'Install a Java 21 JDK for your OS; this fallback supports the Debian cloud image only.' >&2
  exit 1
fi
mkdir -p .cache/apt/{empty,lists/partial,archives/partial,packages} .tools/jdk
apt_dir="$PWD/.cache/apt"
cat >"$apt_dir/sources.list" <<'EOF'
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://security.debian.org/debian-security trixie-security main
EOF
cat >"$apt_dir/config" <<EOF
Dir::Etc::parts "$apt_dir/empty";
Dir::Etc::main "$apt_dir/config";
Dir::Etc::sourcelist "$apt_dir/sources.list";
Dir::Etc::sourceparts "$apt_dir/empty";
Dir::State::lists "$apt_dir/lists";
Dir::Cache::archives "$apt_dir/archives";
APT::Get::List-Cleanup "0";
EOF
APT_CONFIG="$apt_dir/config" apt-get update
(cd "$apt_dir/packages" && APT_CONFIG="$apt_dir/config" apt-get download openjdk-21-jdk-headless openjdk-21-jre-headless)
for package in "$apt_dir"/packages/openjdk-21-*.deb; do
  dpkg-deb -x "$package" "$PWD/.tools/jdk"
done
"$jdk_dir/bin/javac" -version
echo 'Local Java 21 JDK extracted from verified Debian packages.'
