#!/bin/sh
# hotfix-devices-acl.sh — make the admin board's Devices page work on
# OpenWrt 25.x, without waiting for a release.
#
# Why: on OpenWrt 25.x the `dhcp` ubus object has no `ipv4leases` method, so the
# board falls back to reading `/tmp/dhcp.leases` via `ubus call file read`. The
# tollgate rpcd ACL granted `ubus.file: ["read"]` but had no FILE PATH map, so
# rpcd denied every path (`result:[6]`); the board then mislabels that as
# `SESSION_EXPIRED`. This adds the path to the ACL (the source is
# openwrt/rpcd/tollgate_acl.json) and restarts rpcd.
#
# Idempotent. Backs the previous ACL up to /tmp/pre13-acl-backup-<ts>/.
# Set TG_PASSWORD=<root-password> to self-verify via the board's exact
# /ubus JSON-RPC flow (fresh login then file read); otherwise it verifies the
# installed file and prints the browser check.
#
# Usage (on the router):
#   curl -fsSL <raw-url> | sh
#   TG_PASSWORD=secret curl -fsSL <raw-url> | sh
set -eu

ACL_DIR=/usr/share/rpcd/acl.d
ACL="$ACL_DIR/tollgate.json"
TS=$(date +%s)
BK="/tmp/pre13-acl-backup-$TS"

echo "== TollGate Devices ACL hot-fix =="

mkdir -p "$BK"
if [ -f "$ACL" ]; then
    cp "$ACL" "$BK/tollgate.json"
    echo "[1/3] backed up $ACL -> $BK/tollgate.json"
else
    echo "[1/3] no existing $ACL (creating)"
fi

cat > "$ACL" <<'JSON'
{
  "tollgate": {
    "description": "Tollgate management",
    "read": {
      "ubus": {
        "tollgate": [
          "config_schema",
          "config_get",
          "wallet_balance",
          "wallet_info",
          "status",
          "health",
          "pricing",
          "sessions",
          "upstream_scan",
          "upstream_list"
        ],
        "system": ["info", "board"],
        "network.interface": ["dump"],
        "network.wireless": ["status"],
        "dhcp": ["ipv4leases", "ipv6leases"],
        "uci": ["get", "state"],
        "file": ["read"]
      },
      "file": {
        "/tmp/dhcp.leases": ["read"]
      },
      "uci": ["tollgate", "wireless", "system", "network", "dhcp"]
    },
    "write": {
      "ubus": {
        "tollgate": [
          "config_set",
          "config_save",
          "config_save_identities",
          "wallet_fund",
          "wallet_drain_cashu",
          "activate",
          "upstream_connect",
          "upstream_remove"
        ],
        "network.wireless": ["reload"],
        "system": ["password_set"],
        "uci": [
          "set",
          "add",
          "delete",
          "commit",
          "apply",
          "confirm",
          "rollback",
          "reorder"
        ],
        "file": ["exec"]
      },
      "uci": ["wireless", "system", "network"]
    }
  }
}
JSON
chmod 600 "$ACL"
echo "[2/3] installed ACL with read.file[\"/tmp/dhcp.leases\"]"

/etc/init.d/rpcd restart 2>/dev/null || /etc/init.d/rpcd reload 2>/dev/null || true
sleep 1
echo "[3/3] rpcd restarted"

# Optional self-verification against the board's exact JSON-RPC flow.
if [ -n "${TG_PASSWORD:-}" ]; then
    API="http://127.0.0.1:8090/ubus"
    login='{"jsonrpc":"2.0","id":1,"method":"call","params":["00000000000000000000000000000000","session","login",{"username":"root","password":"'"$TG_PASSWORD"'"}]}'
    resp=$(printf '%s' "$login" | curl -fsS -X POST "$API" -H 'Content-Type: application/json' --data-binary @- 2>/dev/null || true)
    sid=$(printf '%s' "$resp" | sed -n 's/.*"ubus_rpc_session":"\([0-9a-f]*\)".*/\1/p')
    if [ -z "$sid" ]; then
        echo "WARN: could not log in via /ubus (is the board up?); skipping self-check" >&2
    else
        call='{"jsonrpc":"2.0","id":2,"method":"call","params":["'"$sid"'","file","read",{"path":"/tmp/dhcp.leases"}]}'
        out=$(printf '%s' "$call" | curl -fsS -X POST "$API" -H 'Content-Type: application/json' --data-binary @- 2>/dev/null || true)
        echo "file read -> $out"
        case "$out" in
            *'"result":[0'*) echo "OK: ACL allows /tmp/dhcp.leases (was result:[6])" ;;
            *) echo "FAIL: file read still not allowed" >&2; exit 1 ;;
        esac
    fi
fi

echo
echo "Done. Open http://<router-lan-ip>:8090/#/devices (log in)."
echo "Expected: leases listed, or 'No connected devices found' — never SESSION_EXPIRED."
echo "Rollback: cp $BK/tollgate.json $ACL && /etc/init.d/rpcd restart"
