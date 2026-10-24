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
#
# IMPORTANT for curl|bash: this reads the password from /dev/tty, never from
# stdin. When run as `curl ... | bash`, the script's stdin is the curl pipe,
# not your terminal — reading there yields EOF and an empty password. We
# deliberately bypass that by reading the controlling terminal directly.
set -euo pipefail

IP="${1:-192.168.1.1}"

echo "Reverting LuCI HTTP->HTTPS redirect on uhttpd.main @ $IP"
echo "(fixes pre13 'can't log in at all anymore' when TLS :443 is not serving)"

# Locate the controlling terminal so password prompt works under curl|bash.
TTY="${TTY:-/dev/tty}"

if command -v sshpass >/dev/null 2>&1; then
  read -r -s -p "Enter router root password: " PW < "$TTY" 2>&1 || {
    echo "Could not read from $TTY — run interactively: ssh root@$IP" >&2
    exit 1
  }
  echo >&2
  REMOTE_CMD='uci set uhttpd.main.redirect_https="0"; uci commit uhttpd; /etc/init.d/uhttpd restart; uci get uhttpd.main.redirect_https'
  echo "Running on router: $REMOTE_CMD"
  # -tt forces a TTY so sshpass can hand the password to ssh's askpass over a
  # real controlling terminal (avoids "no pseudo-terminal allocated").
  SSHPASS="$PW" sshpass -e ssh -tt -o StrictHostKeyChecking=no -o ConnectTimeout=8 root@"$IP" "$REMOTE_CMD"
  echo
  echo "Verify: redirect_https is now '0'. LuCI login:  http://$IP:8080/"
  echo "Admin board (pre13 bundle) is unaffected on :8090."
else
  echo "sshpass not installed. Run these three commands in an interactive ssh session:" >&2
  echo >&2
  echo "  ssh root@$IP" >&2
  echo >&2
  cat <<'EOSH'
uci set uhttpd.main.redirect_https='0'
uci commit uhttpd
/etc/init.d/uhttpd restart
uci get uhttpd.main.redirect_https
EOSH
  echo >&2
  echo "(Tip: apt install sshpass to use this script non-interactively.)" >&2
  exit 0
fi
