#!/bin/bash
# Dijalankan di VM pxe-test-server sebagai root VM (via ssh_root 'bash -s'), dipanggil
# infra/deploy-dashboard.sh. Input env: RELEASE_TS, STAGE (dir upload di VM berisi
# release.tar.xz, dashboard.env, pxe-dashboard.service, nginx-pxe.conf).
set -euo pipefail
: "${RELEASE_TS:?}" "${STAGE:?}"
[[ "$RELEASE_TS" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "RELEASE_TS tidak valid" >&2; exit 1; }
[[ "$STAGE" == /tmp/pxe-test-deploy.* ]] || { echo "STAGE tidak valid" >&2; exit 1; }
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

install -m 0640 -o root -g pxe "$STAGE/dashboard.env" /etc/pxe-dashboard.env
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

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/api/settings -H 'Host: 10.99.0.2'; then break; fi
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
