#!/usr/bin/env bash
# infra/deploy-dashboard.sh — build dashboard Next mode standalone di HOST lalu deploy ke VM
# pxe-test-server (10.99.0.2):
#   host: PXE_STANDALONE=1 npm run build -> release.tar.xz (.next/standalone + .next/static + public,
#         tanpa .env*/data/*.db) -> scp (user pxe) ke /tmp/pxe-test-deploy.<ts> di VM
#   VM  : server/install-dashboard.sh (root VM): rilis /opt/pxe-dashboard/releases/<ts> +
#         symlink current, /etc/pxe-dashboard.env (server/dashboard.env), unit pxe-dashboard
#         (user pxe, HOSTNAME=127.0.0.1 PORT=3000, DB /var/lib/pxe-dashboard), nginx
#         10.99.0.2:80 (X-Real-IP, X-Forwarded-* dibuang), restart, cek listen 127.0.0.1:3000.
#   host: tunggu GET http://10.99.0.2/api/settings 200 dengan cidr 10.99.0.0/24.
# Bukti: <runs>/deploy-dashboard.txt. Env: SKIP_BUILD=1 (pakai build yang ada), INFRA_DRY_RUN=1,
# PXE_ADMIN_ALLOW (IP/CIDR admin untuk UI + /api/** di nginx, default 10.99.0.1, DEC-015).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DASH_DIR="$REPO_DIR/dashboard"
EXPECT_CIDR="10.99.0.0/24"
assert_name "$SERVER_NAME"
ensure_dirs
out="$RUNS_DIR/deploy-dashboard.txt"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
remote_stage="/tmp/pxe-test-deploy.$ts"

for f in dashboard.env pxe-dashboard.service nginx-pxe.conf install-dashboard.sh; do
  [[ -f "$INFRA_DIR/server/$f" ]] || die "infra/server/$f tidak ada"
done
if ! is_dry; then
  dom_running "$SERVER_NAME" || die "$SERVER_NAME belum berjalan (server-up.sh)"
  [[ -f "$SSH_KEY" ]] || die "key $SSH_KEY tidak ada (server-base.sh)"
fi

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
cp "$INFRA_DIR/server/dashboard.env" "$INFRA_DIR/server/pxe-dashboard.service" \
  "$INFRA_DIR/server/nginx-pxe.conf" "$stage/"
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
body=""
for _ in $(seq 1 60); do
  if body="$(curl -fsS --max-time 5 "http://$SERVER_IP/api/settings")"; then break; fi
  body=""; sleep 2
done
[[ -n "$body" ]] || die "GET http://$SERVER_IP/api/settings tidak 200"
{
  echo "# host: GET http://$SERVER_IP/api/settings"
  echo "$body"
} >> "$out"
grep -q "\"cidr\":\"$EXPECT_CIDR\"" <<<"$body" || die "api/settings cidr bukan $EXPECT_CIDR (lihat $out)"
log "dashboard aktif di http://$SERVER_IP (bukti $out)"
