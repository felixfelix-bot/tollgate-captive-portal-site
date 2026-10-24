#!/bin/sh
# hotdeploy-admin-8090.sh — repair :8090 on an OpenWrt router and deploy the
# current TollGate admin (config) board.
#
# Why: on the older scheme uhttpd.admin.home=/www, so uhttpd served LuCI at
# http://<router>:8090/ (and its cgi_prefix resolved :8090/cgi-bin/luci to the
# REAL LuCI CGI). This sets the brand webroot (/www/tollgate), serves the board
# over plain HTTP on :8090 (the URL people actually type, `http://…:8090/`,
# matching LuCI's own http on :8080), deletes cgi_prefix/lua_prefix so the LuCI
# CGI can never be wired to the admin port, keeps :8090 exclusive, and installs
# the TollGate-branded board.
#
# NOTE: a single uhttpd instance cannot serve HTTP and HTTPS on the same port,
# so :8090 is HTTP. An HTTPS-only board would make `http://…:8090/` fail.
#
# TollGate brand. Idempotent. LuCI stays on :8080.
#
# Usage (on the router):
#   curl -fsSL <raw-url-of-this-file> | sh

ADMIN_HOME=/www/tollgate
ASSET_URL="https://github.com/felixfelix-bot/tollgate-captive-portal-site/releases/download/admin-hotdeploy-20260920/tollgate-admin-tollgate.tar.gz"

die() { echo "ERROR: $*" >&2; exit 1; }

echo "== TollGate admin :8090 hot-deploy (HTTP) =="

echo "[1/4] configuring uhttpd.admin (webroot ${ADMIN_HOME}; HTTP on :8090; no LuCI)"
uci -q get uhttpd.admin >/dev/null 2>&1 || uci set uhttpd.admin=uhttpd || die "uci set uhttpd.admin"
uci -q delete uhttpd.admin.listen_http
uci -q delete uhttpd.admin.listen_https
uci add_list uhttpd.admin.listen_http='0.0.0.0:8090'
uci add_list uhttpd.admin.listen_http='[::]:8090'
uci -q delete uhttpd.admin.cert
uci -q delete uhttpd.admin.key
uci set uhttpd.admin.ubus_prefix='/ubus'
uci set uhttpd.admin.script_timeout='60'
uci set uhttpd.admin.network_timeout='30'
uci set uhttpd.admin.max_requests='3'
uci set uhttpd.admin.tcp_keepalive='1'
uci set uhttpd.admin.no_dirlists='1'
uci set uhttpd.admin.home="$ADMIN_HOME"
uci set uhttpd.admin.error_page='/index.html'
# never let the admin port resolve LuCI's /cgi-bin/luci
uci -q delete uhttpd.admin.cgi_prefix
uci -q delete uhttpd.admin.lua_prefix
# :8090 belongs to the admin instance alone
for sec in $(uci show uhttpd 2>/dev/null | sed -n 's/^uhttpd\.\([^.]*\)=uhttpd$/\1/p'); do
    if [ "$sec" != "admin" ]; then
        uci -q del_list "uhttpd.$sec.listen_http=0.0.0.0:8090"
        uci -q del_list "uhttpd.$sec.listen_http=[::]:8090"
        uci -q del_list "uhttpd.$sec.listen_https=0.0.0.0:8090"
        uci -q del_list "uhttpd.$sec.listen_https=[::]:8090"
    fi
done
uci commit uhttpd || die "uci commit uhttpd"

echo "[2/4] deploying TollGate admin board to ${ADMIN_HOME}"
mkdir -p "$ADMIN_HOME" || die "mkdir $ADMIN_HOME"
TS="$(date +%s)"
tar czf "/tmp/www-tollgate-before-${TS}.tgz" -C "$ADMIN_HOME" . 2>/dev/null || true
TMP="/tmp/tg-admin-${TS}"
mkdir -p "$TMP"
if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$TMP/admin.tgz" "$ASSET_URL" || die "download"
elif command -v uclient-fetch >/dev/null 2>&1; then
    uclient-fetch -q -O "$TMP/admin.tgz" "$ASSET_URL" || die "download"
elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TMP/admin.tgz" "$ASSET_URL" || die "download"
else
    die "no curl/uclient-fetch/wget on this router"
fi
tar xzf "$TMP/admin.tgz" -C "$ADMIN_HOME" || die "extract"
rm -rf "$TMP"

echo "[3/4] restarting rpcd + uhttpd"
/etc/init.d/rpcd restart 2>/dev/null || true
/etc/init.d/uhttpd restart || die "uhttpd restart"

echo "[4/4] verifying (http)"
sleep 1
get() {
    if command -v curl >/dev/null 2>&1; then curl -fsS "$1" 2>/dev/null
    else uclient-fetch -q -O - "$1" 2>/dev/null
    fi
}
title() { get "$1" | sed -n 's/.*<title>\([^<]*\)<\/title>.*/\1/p' | head -1; }
echo "  http://:8090/              -> $(title "http://127.0.0.1:8090/" || true)"
echo "  http://:8090/cgi-bin/luci  -> $(title "http://127.0.0.1:8090/cgi-bin/luci" || true)"
echo
echo "OK. Open http://<router-lan-ip>:8090/  (login root / router password)."
echo "LuCI stays on :8080."
echo "Backup of the previous webroot: /tmp/www-tollgate-before-${TS}.tgz"
