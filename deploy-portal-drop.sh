#!/usr/bin/env bash
# Surgical portal-SPA drop onto a physical OpenWrt router (no feed reinstall).
# Bundle source of truth: FreedomTechFeed/packages @ pre13  (CI-verified vendored bundle)
#   net/tollgate-wrt/files/tollgate-captive-portal-site  ->  router:/etc/tollgate/tollgate-captive-portal-site
#
# usage: deploy-portal-drop.sh <ROUTER_IP> [DEST_DIR]
#   env: TOLLGATE_PORTAL_REF   (default: pre13)
#        TOLLGATE_FEED_REPO    (default: FreedomTechFeed/packages)
set -euo pipefail

ROUTER="${1:-}"
DEST="${2:-/etc/tollgate/tollgate-captive-portal-site}"
REF="${TOLLGATE_PORTAL_REF:-pre13}"
FEED_REPO="${TOLLGATE_FEED_REPO:-FreedomTechFeed/packages}"
SUBDIR="net/tollgate-wrt/files/tollgate-captive-portal-site"

if [ -z "$ROUTER" ]; then
  echo "usage: deploy-portal-drop.sh <ROUTER_IP> [DEST_DIR]" >&2
  exit 2
fi

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
echo "== fetching ${FEED_REPO}@${REF} portal bundle"
curl -fsSL "https://codeload.github.com/${FEED_REPO}/tar.gz/refs/heads/${REF}" -o "$tmp/feed.tgz"
tar -xzf "$tmp/feed.tgz" -C "$tmp"
src="$(find "$tmp" -type d -path "*/${SUBDIR}" | head -1)"
[ -n "$src" ] || { echo "ERROR: portal dir not found in feed tarball" >&2; exit 3; }
echo "== bundle: $(find "$src" -type f | wc -l) files, $(du -sh "$src" | cut -f1)"

tar -czf "$tmp/bundle.tgz" -C "$src" .
echo "== pushing to root@${ROUTER}:${DEST}"
scp -o StrictHostKeyChecking=accept-new "$tmp/bundle.tgz" "root@${ROUTER}:/tmp/tollgate-portal-bundle.tgz"
ssh -o StrictHostKeyChecking=accept-new "root@${ROUTER}" "
  set -e
  mkdir -p '${DEST}'
  tar -xzf /tmp/tollgate-portal-bundle.tgz -C '${DEST}'
  /etc/init.d/uhttpd restart >/dev/null 2>&1 || /etc/init.d/uhttpd reload >/dev/null 2>&1 || true
  echo '== on-router ${DEST}:'
  ls -1 '${DEST}' | tr '\n' ' '; echo
"
echo "== done -> http://${ROUTER}:2051/splash.html"
