#!/usr/bin/env bash
# infra/deploy-dashboard.sh — build dashboard Next mode standalone di HOST lalu deploy ke VM
# pxe-test-server (10.99.0.2):
#   host: PXE_STANDALONE=1 npm run build -> release.tar.xz (.next/standalone + .next/static + public,
#         tanpa .env*/data/*.db) -> scp (user pxe) ke /tmp/pxe-test-deploy.<ts> di VM
#   VM  : server/install-dashboard.sh (root VM): rilis /opt/pxe-dashboard/releases/<ts> +
#         symlink current, /etc/pxe-dashboard.env (server/dashboard.env), unit pxe-dashboard
#         (user pxe, HOSTNAME=127.0.0.1 PORT=3000, DB /var/lib/pxe-dashboard), nginx
#         10.99.0.2:80 (X-Real-IP, X-Forwarded-* dibuang), restart, cek listen 127.0.0.1:3000.
#   host: tunggu dashboard menjawab (GET /login), lalu login admin (cookie jar sementara) dan
#         GET /api/settings dengan sesi -> cidr 10.99.0.0/24 + adminConfigured.
# Admin per run (M6-T7, DEC-017 §3): password di file 0600 ($PXE_ADMIN_PASS_FILE, default
# .agent/keys/<run>-admin.pass, dibuat bila belum ada) -> hash scrypt di host (`npm run admin:hash`,
# password lewat stdin) -> overlay env admin.env dikirim ke VM lewat STDIN ssh (bukan argv/scp)
# -> install-dashboard.sh menyisipkan PXE_ADMIN_USERNAME/PXE_ADMIN_PASSWORD_HASH ke
# /etc/pxe-dashboard.env (root:pxe 0640). Password & hash tidak pernah dicetak/di-log.
# Bukti: <runs>/deploy-dashboard.txt. Env: SKIP_BUILD=1 (pakai build yang ada), INFRA_DRY_RUN=1,
# PXE_ADMIN_ALLOW (IP/CIDR admin untuk UI + /api/** di nginx, default 10.99.0.1, DEC-015),
# PXE_ADMIN_USERNAME (default pxeadmin), PXE_ADMIN_PASS_FILE,
# PXE_DEPLOY_BOOTING_TIMEOUT_MIN (opsional, 1-1440: override PXE_JOB_BOOTING_TIMEOUT_MIN, bulk O12).
# --topology vlan (M7, docs/design/M7-plan.md §2.3): env server/dashboard-vlan.env (subnet PXE
# 10.99.10.0/24, PXE_SERVER_IP/BASE/MEDIA 10.99.10.2, PXE_VLAN_NETWORKS VLAN 20) dan nginx
# server/vlan/nginx-pxe-vlan.conf (10.99.0.2:80 + 10.99.10.2:80) dipasang dengan nama file stage yang
# sama; verifikasi dari host TETAP lewat http://10.99.0.2 dan mengasersi cidr 10.99.10.0/24 +
# vlanNetworks memuat VLAN 20 10.99.20.0/24. Default flat = perilaku M6.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

topology=flat
while [[ $# -gt 0 ]]; do
  case "$1" in
    --topology) [[ $# -ge 2 ]] || die "--topology butuh nilai"; topology="$(parse_topology "$2")"; shift 2 ;;
    *) die "argumen tidak dikenal: $1 (pakai: deploy-dashboard.sh [--topology flat|vlan])" ;;
  esac
done
if [[ "$topology" == vlan ]]; then
  EXPECT_CIDR="10.99.10.0/24"
  ENV_SRC="$INFRA_DIR/server/dashboard-vlan.env"
  NGINX_SRC="$INFRA_DIR/server/vlan/nginx-pxe-vlan.conf"
else
  EXPECT_CIDR="10.99.0.0/24"
  ENV_SRC="$INFRA_DIR/server/dashboard.env"
  NGINX_SRC="$INFRA_DIR/server/nginx-pxe.conf"
fi
assert_name "$SERVER_NAME"
ensure_dirs
out="$RUNS_DIR/deploy-dashboard.txt"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
remote_stage="/tmp/pxe-test-deploy.$ts"

for f in "$ENV_SRC" "$INFRA_DIR/server/pxe-dashboard.service" "$NGINX_SRC" "$INFRA_DIR/server/install-dashboard.sh"; do
  [[ -f "$f" ]] || die "${f#"$REPO_DIR"/} tidak ada"
done
if ! is_dry; then
  dom_running "$SERVER_NAME" || die "$SERVER_NAME belum berjalan (server-up.sh)"
  [[ -f "$SSH_KEY" ]] || die "key $SSH_KEY tidak ada (server-base.sh)"
fi
[[ "$ADMIN_USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "PXE_ADMIN_USERNAME '$ADMIN_USERNAME' tidak valid"
booting_min="${PXE_DEPLOY_BOOTING_TIMEOUT_MIN:-}"
if [[ -n "$booting_min" ]]; then
  [[ "$booting_min" =~ ^[0-9]{1,4}$ ]] && ((booting_min >= 1 && booting_min <= 1440)) \
    || die "PXE_DEPLOY_BOOTING_TIMEOUT_MIN '$booting_min' harus 1-1440"
fi
# dashboard.env di repo tidak boleh memuat hash nyata (hanya placeholder; AC-6.53).
! grep -qE 'scrypt\$[0-9]' "$ENV_SRC" || die "${ENV_SRC#"$REPO_DIR"/} memuat hash scrypt nyata"

# --- password + hash admin (host) ---------------------------------------------------------
admin_pass="${PXE_ADMIN_PASS_FILE:-$KEYS_DIR/$PXE_RUN-admin.pass}"
if [[ ! -e "$admin_pass" ]]; then
  log "membuat password admin acak per run -> $admin_pass (0600)"
  admin_pass_new "$admin_pass"
fi
admin_pass_check "$admin_pass"
admin_hash_val="$(admin_hash "$admin_pass")"

# --- build di host -----------------------------------------------------------------------
if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
  log "build standalone (PXE_STANDALONE=1 npm run build)"
  if is_dry; then
    run env PXE_STANDALONE=1 npm --prefix "$DASH_DIR" run build
  else
    (cd "$DASH_DIR" && PXE_STANDALONE=1 npm run build) > "$RUNS_DIR/deploy-build.log" 2>&1 \
      || { tail -30 "$RUNS_DIR/deploy-build.log" >&2; die "build gagal (lihat deploy-build.log)"; }
  fi
fi

stage="$(mktemp -d "${TMPDIR:-/tmp}/pxe-test-deploy.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
if ! is_dry; then
  [[ -f "$DASH_DIR/.next/standalone/server.js" ]] \
    || die "$DASH_DIR/.next/standalone/server.js tidak ada (build bukan mode standalone?)"
  mkdir -p "$stage/app/.next"
  cp -a "$DASH_DIR/.next/standalone/." "$stage/app/"
  cp -a "$DASH_DIR/.next/static" "$stage/app/.next/static"
  [[ -d "$DASH_DIR/public" ]] && cp -a "$DASH_DIR/public" "$stage/app/public"
  # Jangan pernah membawa env lokal, DB dev, atau cache build ke VM.
  rm -rf "$stage/app/data" "$stage/app/.next/cache"
  find "$stage/app" -maxdepth 1 -name '.env*' -exec rm -f {} +
  leaked="$(find "$stage/app" \( -name '*.db' -o -name '*.db-*' -o -name '*.sqlite' -o -name '.env*' \) -not -path '*/node_modules/*' -print -quit)"
  [[ -z "$leaked" ]] || die "artefak terlarang ikut rilis: $leaked"
  tar -C "$stage/app" -cJf "$stage/release.tar.xz" .
  log "rilis $(du -h "$stage/release.tar.xz" | cut -f1) -> $SERVER_IP:$remote_stage"
fi
# Nama file stage tetap (install-dashboard.sh): dashboard.env + nginx-pxe.conf untuk kedua topologi.
cp "$ENV_SRC" "$stage/dashboard.env"
cp "$NGINX_SRC" "$stage/nginx-pxe.conf"
cp "$INFRA_DIR/server/pxe-dashboard.service" "$stage/"
# DEC-015: allowlist admin nginx untuk UI + /api/** (IPv4 atau CIDR IPv4; default host lab).
admin_allow="${PXE_ADMIN_ALLOW:-10.99.0.1}"
[[ "$admin_allow" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/([0-9]|[12][0-9]|3[0-2]))?$ ]] \
  || die "PXE_ADMIN_ALLOW '$admin_allow' harus IPv4 atau CIDR IPv4"
sed -i -E "s#^([[:space:]]*)allow [^;]+; \# PXE_ADMIN_ALLOW\$#\1allow $admin_allow; \# PXE_ADMIN_ALLOW#" "$stage/nginx-pxe.conf"
[[ "$(grep -c "allow $admin_allow; # PXE_ADMIN_ALLOW" "$stage/nginx-pxe.conf")" -ge 2 ]] \
  || die "nginx-pxe.conf: penanda PXE_ADMIN_ALLOW tidak ditemukan"

# --- upload + install di VM ----------------------------------------------------------------
ssh_server "mkdir -m 700 '$remote_stage'"
scp_server "$stage/release.tar.xz" "$stage/dashboard.env" "$stage/pxe-dashboard.service" \
  "$stage/nginx-pxe.conf" "$remote_stage/"
# Overlay env admin: HANYA lewat stdin ssh (umask 077 di VM); argv cuma memuat path tujuan.
# GK-7-1 (DEC-028 §1): di dry-run `run` hanya mencetak dan TIDAK membaca stdin, jadi pipe ke sana
# berlomba dengan penulis (SIGPIPE -> exit 141 di bawah pipefail). Dry-run cukup mencetak perintah
# yang sama dengan stdin /dev/null; jalur non-dry (else) tidak berubah.
if is_dry; then
  ssh_server "umask 077 && cat > '$remote_stage/admin.env'" </dev/null
else
  {
    printf 'PXE_ADMIN_USERNAME=%s\n' "$ADMIN_USERNAME"
    printf "PXE_ADMIN_PASSWORD_HASH='%s'\n" "$admin_hash_val"
    [[ -z "$booting_min" ]] || printf 'PXE_JOB_BOOTING_TIMEOUT_MIN=%s\n' "$booting_min"
  } | ssh_server "umask 077 && cat > '$remote_stage/admin.env'"
fi
unset admin_hash_val
if is_dry; then
  ssh_root "RELEASE_TS=$ts STAGE=$remote_stage bash -s" < "$INFRA_DIR/server/install-dashboard.sh"
  exit 0
fi
{
  echo "# deploy-dashboard $ts (commit $(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo ?))"
  rc=0
  ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" "RELEASE_TS=$ts STAGE=$remote_stage bash -s" \
    < "$INFRA_DIR/server/install-dashboard.sh" 2>&1 || rc=$?
  echo "# install-dashboard exit=$rc"
} > "$out"
grep -q '^# install-dashboard exit=0$' "$out" || { tail -40 "$out" >&2; die "install di VM gagal (lihat $out)"; }

# --- verifikasi dari host (lewat nginx 10.99.0.2:80) ---------------------------------------
# M6: semua API butuh sesi. Tunggu dashboard menjawab (/login), pastikan /api/settings tanpa sesi
# ditolak 401, lalu login admin (cookie jar sementara 0600 di stage, dihapus trap) dan baca
# settings dengan sesi. Hanya kode HTTP + body settings yang dicatat (tanpa cookie/password).
code=000
for _ in $(seq 1 60); do
  code="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://$SERVER_IP/login" 2>/dev/null)" || code=000
  [[ "$code" == 200 ]] && break
  sleep 2
done
[[ "$code" == 200 ]] || die "GET http://$SERVER_IP/login tidak 200 (aktual $code)"
noauth="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://$SERVER_IP/api/settings" 2>/dev/null)" || noauth=000
jar="$stage/session.jar"
# Login sukses = 204 + Set-Cookie pxe_session (AC-6.5); status lain / tanpa cookie = gagal.
login_code="$(admin_login "$admin_pass" "$jar")" || { rm -f "$jar"; die "login admin gagal (HTTP $login_code, wajib 204 + cookie pxe_session) — hash admin tidak diterima dashboard? (lihat $out)"; }
body="$(curl -fsS --max-time 5 -b "$jar" "http://$SERVER_IP/api/settings" 2>/dev/null)" || body=""
rm -f "$jar"
{
  echo "# host: GET http://$SERVER_IP/login -> $code"
  echo "# host: GET http://$SERVER_IP/api/settings tanpa sesi -> $noauth"
  echo "# host: POST /api/auth/login (admin $ADMIN_USERNAME) -> $login_code"
  echo "# host: GET http://$SERVER_IP/api/settings dengan sesi"
  echo "$body"
} >> "$out"
[[ "$noauth" == 401 ]] || die "GET /api/settings tanpa sesi harus 401 (aktual $noauth, lihat $out)"
grep -q "\"cidr\":\"$EXPECT_CIDR\"" <<<"$body" || die "api/settings cidr bukan $EXPECT_CIDR (lihat $out)"
grep -q '"adminConfigured":true' <<<"$body" || die "api/settings: adminConfigured bukan true (lihat $out)"
if [[ "$topology" == vlan ]]; then
  # M7: VLAN management terdaftar (PXE_VLAN_NETWORKS) terbaca dashboard.
  python3 -I -c 'import json,sys
d = json.loads(sys.argv[1])
ok = any(v.get("vlan") == 20 and v.get("cidr") == "10.99.20.0/24" and v.get("gateway") == "10.99.20.1" for v in d.get("vlanNetworks") or [])
sys.exit(0 if ok else 1)' "$body" 2>/dev/null || die "api/settings: vlanNetworks tanpa VLAN 20 10.99.20.0/24 gw 10.99.20.1 (lihat $out)"
fi
log "dashboard aktif di http://$SERVER_IP (bukti $out)"
