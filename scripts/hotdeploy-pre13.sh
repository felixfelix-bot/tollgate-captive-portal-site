#!/bin/sh
# hotdeploy-pre13.sh — put the pre13 portal + admin fixes on a router WITHOUT
# waiting for the feed release, so the change can be verified end to end.
#
# Installs:
#   - guest portal bundle  -> /etc/tollgate/tollgate-captive-portal-site/  (:2051)
#   - admin board bundle   -> /www/tollgate/                               (:8090)
#   - tollgate rpcd ACL    -> /usr/share/rpcd/acl.d/tollgate.json  (adds the
#     /tmp/dhcp.leases read path so the Devices page works on OpenWrt 25.x)
#   - LuCI HTTPS redirect  -> uhttpd.main.redirect_https=1 (cert-guarded)
#
# Fixes verified: captive-portal no longer blanks on token paste; board
# #/devices no longer shows SESSION_EXPIRED; LuCI http://:8080 -> https://.
#
# Idempotent. Backs everything up to /tmp/pre13-backup-<ts>/ with a restore.sh.
# Usage (on the router):
#   curl -fsSL <raw-url> | sh
set -eu

ADMIN_HOME=/www/tollgate
PORTAL_HOME=/etc/tollgate/tollgate-captive-portal-site
ACL=/usr/share/rpcd/acl.d/tollgate.json
BASE="https://github.com/felixfelix-bot/tollgate-captive-portal-site/releases/download/pre13-hotdeploy"
TS=$(date +%s)
BK="/tmp/pre13-backup-$TS"
TMP="/tmp/pre13-dl-$TS"

echo "== TollGate pre13 hot-deploy =="

mkdir -p "$BK" "$TMP"

get() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL -o "$2" "$1"
    else
        uclient-fetch -q -O "$2" "$1"
    fi
}

echo "[1/6] backing up current state to $BK"
[ -d "$ADMIN_HOME" ] && tar czf "$BK/admin.tgz" -C "$ADMIN_HOME" . 2>/dev/null || true
[ -d "$PORTAL_HOME" ] && tar czf "$BK/portal.tgz" -C "$PORTAL_HOME" . 2>/dev/null || true
cp /etc/config/uhttpd "$BK/uhttpd" 2>/dev/null || true
cp "$ACL" "$BK/tollgate.json" 2>/dev/null || true
cat > "$BK/restore.sh" <<RESTORE
#!/bin/sh
set -eu
[ -f "$BK/admin.tgz" ] && { rm -rf "$ADMIN_HOME"; mkdir -p "$ADMIN_HOME"; tar xzf "$BK/admin.tgz" -C "$ADMIN_HOME"; }
[ -f "$BK/portal.tgz" ] && { rm -rf "$PORTAL_HOME"; mkdir -p "$PORTAL_HOME"; tar xzf "$BK/portal.tgz" -C "$PORTAL_HOME"; }
[ -f "$BK/uhttpd" ] && cp "$BK/uhttpd" /etc/config/uhttpd
[ -f "$BK/tollgate.json" ] && cp "$BK/tollgate.json" "$ACL"
/etc/init.d/rpcd restart 2>/dev/null || true
/etc/init.d/uhttpd restart 2>/dev/null || true
echo "restored pre13 backup $BK"
RESTORE
chmod +x "$BK/restore.sh"

echo "[2/6] downloading bundles"
get "$BASE/portal-build.tar.gz" "$TMP/portal.tgz"
get "$BASE/admin-build.tar.gz" "$TMP/admin.tgz"

echo "[3/6] installing guest portal -> $PORTAL_HOME"
rm -rf "$PORTAL_HOME"
mkdir -p "$PORTAL_HOME"
tar xzf "$TMP/portal.tgz" -C "$PORTAL_HOME"

echo "[4/6] installing admin board -> $ADMIN_HOME"
rm -rf "$ADMIN_HOME"
mkdir -p "$ADMIN_HOME"
tar xzf "$TMP/admin.tgz" -C "$ADMIN_HOME"

echo "[5/6] installing ACL + LuCI redirect"
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

if [ -f /etc/uhttpd.crt ] && [ -f /etc/uhttpd.key ]; then
    uci set uhttpd.main.redirect_https='1'
    uci commit uhttpd
    echo "      LuCI http://:8080 -> https:// (cert present)"
else
    echo "      no cert/key: leaving LuCI redirect off"
fi

/etc/init.d/rpcd restart 2>/dev/null || true
/etc/init.d/uhttpd restart 2>/dev/null || true
sleep 2

echo "[6/6] verifying"
t() { curl -s "http://127.0.0.1:$1/" | sed -n 's/.*<title>\([^<]*\)<\/title>.*/\1/p' | head -1; }
echo "      :8090 board   -> $(t 8090)"
echo "      :2051 portal  -> $(t 2051)"
echo "      http://:8080/ -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)  (301 expected)"

echo
echo "Done. Verify in a browser:"
echo "  - http://<gw>:2051/  paste a Cashu token -> portal stays, purchase works"
echo "  - http://<gw>:8090/#/devices  after login -> leases or 'No connected devices found'"
echo "  - http://<gw>:8080/ -> https://<gw>/ (no insecure-password warning)"
echo "Rollback: sh $BK/restore.sh"
