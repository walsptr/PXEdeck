#!/bin/bash
# Dijalankan di VM pxe-test-server sebagai root VM (via ssh_root 'bash -s'), dipanggil
# infra/deploy-dashboard.sh. Input env: RELEASE_TS, STAGE (dir upload di VM berisi
# release.tar.xz, dashboard.env, pxe-dashboard.service, nginx-pxe.conf, admin.env).
# admin.env (M6-T7, dikirim lewat stdin ssh, 0600): PXE_ADMIN_USERNAME, PXE_ADMIN_PASSWORD_HASH
# (scrypt), opsional PXE_JOB_BOOTING_TIMEOUT_MIN. Baris kunci itu di dashboard.env (placeholder
# @PXE_ADMIN_PASSWORD_HASH@ atau tidak ada) diganti nilai overlay; hasil /etc/pxe-dashboard.env
# root:pxe 0640. Nilai hash TIDAK PERNAH dicetak (tanpa set -x; pesan hanya menyebut nama kunci).
set -euo pipefail
: "${RELEASE_TS:?}" "${STAGE:?}"
[[ "$RELEASE_TS" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "RELEASE_TS tidak valid" >&2; exit 1; }
[[ "$STAGE" == /tmp/pxe-test-deploy.* ]] || { echo "STAGE tidak valid" >&2; exit 1; }
# Overlay admin (berisi hash) tidak boleh tertinggal di stage bila install gagal di tengah jalan.
trap 'rm -f "$STAGE/admin.env"' EXIT
[[ -x /opt/node/bin/node ]] || { echo "/opt/node/bin/node tidak ada (server-base.sh)" >&2; exit 1; }

rel="/opt/pxe-dashboard/releases/$RELEASE_TS"
mkdir -p "$rel"
tar -xJf "$STAGE/release.tar.xz" -C "$rel"
chown -R root:root "$rel"
# Cache runtime Next (.next/cache) satu-satunya yang ditulis aplikasi di dir rilis.
mkdir -p "$rel/.next/cache"
chown pxe:pxe "$rel/.next/cache"
ln -sfn "$rel" /opt/pxe-dashboard/current.new
mv -T /opt/pxe-dashboard/current.new /opt/pxe-dashboard/current

# --- env + admin (overlay) ---
ov="$STAGE/admin.env"
[[ -f "$ov" ]] || { echo "FAIL admin.env tidak ada di stage (deploy tanpa admin ditolak)" >&2; exit 1; }
OVERLAY_KEYS='PXE_ADMIN_USERNAME|PXE_ADMIN_PASSWORD_HASH|PXE_JOB_BOOTING_TIMEOUT_MIN'
SCRYPT_RE='^scrypt\$[0-9]{1,7}\$[0-9]{1,2}\$[0-9]{1,2}\$[A-Za-z0-9+/_=-]{16,}\$[A-Za-z0-9+/_=-]{16,}$'
have_user=0; have_hash=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  key="${line%%=*}"; val="${line#*=}"
  [[ "$key" =~ ^($OVERLAY_KEYS)$ ]] || { echo "FAIL admin.env: kunci tidak diizinkan" >&2; exit 1; }
  case "$key" in
    PXE_ADMIN_USERNAME) [[ "$val" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "FAIL admin.env: PXE_ADMIN_USERNAME tidak valid" >&2; exit 1; }; have_user=1 ;;
    PXE_ADMIN_PASSWORD_HASH) v="${val#\'}"; v="${v%\'}"
      [[ "$val" == "'$v'" && "$v" =~ $SCRYPT_RE ]] || { echo "FAIL admin.env: PXE_ADMIN_PASSWORD_HASH bukan scrypt ber-kutip tunggal" >&2; exit 1; }; have_hash=1 ;;
    PXE_JOB_BOOTING_TIMEOUT_MIN) [[ "$val" =~ ^[0-9]{1,4}$ ]] || { echo "FAIL admin.env: PXE_JOB_BOOTING_TIMEOUT_MIN tidak valid" >&2; exit 1; } ;;
  esac
done < "$ov"
((have_user && have_hash)) || { echo "FAIL admin.env tanpa PXE_ADMIN_USERNAME/PXE_ADMIN_PASSWORD_HASH" >&2; exit 1; }
envtmp="$(mktemp /etc/.pxe-dashboard.env.XXXXXX)"
chmod 0640 "$envtmp"; chown root:pxe "$envtmp"
{ grep -vE "^[[:space:]]*($OVERLAY_KEYS)=" "$STAGE/dashboard.env" || true
  echo "# --- disisipkan install-dashboard.sh (M6-T7) ---"
  cat "$ov"; } > "$envtmp"
grep -q '@PXE_ADMIN_PASSWORD_HASH@' "$envtmp" && { rm -f "$envtmp"; echo "FAIL placeholder hash tersisa" >&2; exit 1; }
mv -f "$envtmp" /etc/pxe-dashboard.env
rm -f "$ov"
echo "OK   /etc/pxe-dashboard.env $(stat -c '%a %U:%G' /etc/pxe-dashboard.env) (admin $(grep -c '^PXE_ADMIN_' /etc/pxe-dashboard.env) kunci, nilai tidak dicetak)"
install -m 0644 "$STAGE/pxe-dashboard.service" /etc/systemd/system/pxe-dashboard.service
install -m 0644 "$STAGE/nginx-pxe.conf" /etc/nginx/sites-available/pxe
ln -sf /etc/nginx/sites-available/pxe /etc/nginx/sites-enabled/pxe
rm -f /etc/nginx/sites-enabled/default
# Script iPXE statis sisa smoke test akan membayangi /boot dashboard (try_files) -> buang.
find /srv/pxe/boot -maxdepth 1 -type f -name '*.ipxe' -print -delete

nginx -t
systemctl daemon-reload
systemctl enable pxe-dashboard >/dev/null 2>&1
systemctl restart pxe-dashboard
systemctl reload-or-restart nginx
rm -rf "$STAGE"

# Siap = Next menjawab HTTP apa pun di /login (API butuh sesi sejak M6 -> 401 tanpa cookie).
for _ in $(seq 1 60); do
  c="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login -H 'Host: 10.99.0.2' 2>/dev/null || true)"
  [[ "$c" =~ ^[1-5][0-9][0-9]$ ]] && break
  sleep 1
done
echo "# release $rel ($(/opt/node/bin/node --version))"
echo "# systemctl is-active"; for s in pxe-dashboard nginx dnsmasq; do printf '%-14s %s\n' "$s" "$(systemctl is-active "$s")"; done
echo "# listen :3000 / :80"; ss -ltnpH | awk '$4 ~ /:(3000|80)$/'
bad=0
while read -r _ _ _ local _ proc; do
  case "$local" in
    127.0.0.1:3000) echo "OK   next listen $local" ;;
    *:3000) echo "FAIL next listen $local (harus 127.0.0.1:3000)"; bad=1 ;;
  esac
done < <(ss -ltnpH)
ss -ltnH | awk '{print $4}' | grep -qx '127.0.0.1:3000' || { echo "FAIL next tidak listen 127.0.0.1:3000"; bad=1; }
[[ "$(systemctl is-active pxe-dashboard)" == active ]] || { echo "FAIL pxe-dashboard tidak aktif"; journalctl -u pxe-dashboard -n 40 --no-pager; bad=1; }
exit "$bad"
