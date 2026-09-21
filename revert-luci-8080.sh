#!/bin/bash
# revert-luci-8080.sh
#
# TollGate pre13 regression fix: undo the forced HTTP->HTTPS redirect that
# pre13's 92-tollgate-admin-setup added to uhttpd.main.
#
# Background (probed live on the MT3000, 2026-09-21):
#   pre13 gained this block in the vendored 92-tollgate-admin-setup:
#     if [ -f /etc/uhttpd.crt ] && [ -f /etc/uhttpd.key ]; then
#         uci set uhttpd.main.redirect_https='1'
#     fi
#   When certs exist but no reachable TLS listener is actually bound
#   (:443 Connection refused on this box), LuCI http://<router>:8080/
#   now 307s to https://<router>/ -> dead TLS -> "can't log in at all".
#
# This script reverts redirect_https=0 so LuCI serves over HTTP again.
# Safe & idempotent. The admin board on :8090 is UNAFFECTED (it never had
# redirect_https; it is a separate uhttpd.admin section).
#
# Usage:  bash revert-luci-8080.sh [ROUTER_IP]        (default 192.168.1.1)
# Runs the uci command over ssh as root. Prompts for the router root password.
set -euo pipefail

IP="${1:-192.168.1.1}"

echo "Reverting LuCI HTTP->HTTPS redirect on uhttpd.main @ $IP"
echo "(fixes pre13 'can't log in at all anymore' when TLS :443 is not serving)"

# Determine ssh tooling
if command -v sshpass >/dev/null 2>&1; then
  echo -n "Enter router root password: " >&2
  read -r -s PW; echo >&2
  SSHPASS="$PW" sshpass -e ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 root@"$IP"
else
  echo "sshpass not installed. Open an interactive ssh session — the script will" >&2
  echo "run the revert in it. Run: ssh root@$IP , then paste the block below:" >&2
  echo
  cat <<'EOSH'
uci set uhttpd.main.redirect_https='0'
uci commit uhttpd
/etc/init.d/uhttpd restart
echo "LuCI redirect reverted. Try http://<router>:8080/"
EOSH
  echo
  echo "(Tip: apt install sshpass to run non-interactively next time.)"
  exit 0
fi

REMOTE_CMD='uci set uhttpd.main.redirect_https="0"; uci commit uhttpd; /etc/init.d/uhttpd restart; uci get uhttpd.main.redirect_https'
echo "Running on router: $REMOTE_CMD"
SSHPASS="$PW" sshpass -e ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 root@"$IP" "$REMOTE_CMD"

echo
echo "Verify: redirect_https is now '0'. LuCI login:  http://$IP:8080/"
echo "Admin board (pre13 bundle) is unaffected on :8090."
echo
echo "If you'd rather keep HTTPS-on-LuCI, the real fix is ensuring a bound"
echo "TLS listener: add /etc/uhttpd.crt + /etc/uhttpd.key that uhttpd can"
echo "actually start on :443, then set redirect_https=1."
