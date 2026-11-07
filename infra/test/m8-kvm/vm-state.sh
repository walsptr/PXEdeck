#!/usr/bin/env bash
# infra/test/m8-kvm/vm-state.sh — DIJALANKAN DI VM pxe-test-install (root) lewat
# `ssh root@10.99.0.2 'LABEL=<x> bash -s' < vm-state.sh`. Ringkasan state install.sh/uninstall.sh
# (M8 KVM). Tanpa secret: env dashboard hanya nama kunci + nilai non-admin; hash disamarkan.
set -uo pipefail
echo "## state ${LABEL:-?} $(date -u +%FT%TZ) $(hostname)"
echo "# systemctl (is-active / is-enabled)"
for s in dnsmasq nginx nfs-server pxe-dashboard; do
  printf '%-16s %-10s %s\n' "$s" "$(systemctl is-active "$s.service" 2>/dev/null)" "$(systemctl is-enabled "$s.service" 2>/dev/null)"
done
echo "# pxe-dashboard unit (idempotensi: PID/waktu start sama = tidak di-restart)"
systemctl show -p MainPID -p ActiveEnterTimestamp -p NRestarts -p Result -p LoadState pxe-dashboard.service 2>/dev/null
echo "# ss -lunp (udp)"; ss -lunpH 2>/dev/null | awk '{print $1, $4, $5, $6}'
echo "# ss -ltnp (tcp)"; ss -ltnpH 2>/dev/null | awk '{print $1, $4, $5, $6}'
echo "# port PXE terbuka (udp 67/69, tcp 80/3000/2049)"
ss -lntupH 2>/dev/null | awk '{n=split($5,a,":"); p=a[n]; if (($1=="udp" && (p==67||p==69)) || ($1=="tcp" && (p==80||p==3000||p==2049))) print "OPEN", $1, $5, $7}' | sed 's/^$//' ; echo "# (akhir daftar port)"
echo "# manifest /var/lib/pxe-dashboard-installer/install-manifest"
if [[ -f /var/lib/pxe-dashboard-installer/install-manifest ]]; then
  stat -c 'mode=%a owner=%U:%G' /var/lib/pxe-dashboard-installer/install-manifest
  cat /var/lib/pxe-dashboard-installer/install-manifest
else echo "(tidak ada)"; fi
echo "# /opt/pxe-dashboard"
if [[ -d /opt/pxe-dashboard ]]; then
  echo "current -> $(readlink /opt/pxe-dashboard/current 2>/dev/null)"
  echo "release-id: $(cat /opt/pxe-dashboard/current/.pxe-release-id 2>/dev/null)"
  ls -1 /opt/pxe-dashboard/releases 2>/dev/null | sed 's/^/release /'
  echo "node: $(/opt/pxe-dashboard/node/bin/node --version 2>/dev/null) sha-marker=$(cat /opt/pxe-dashboard/node/.pxe-node-sha256 2>/dev/null)"
else echo "(tidak ada)"; fi
echo "# /etc/pxe-dashboard.env"
if [[ -f /etc/pxe-dashboard.env ]]; then
  stat -c 'mode=%a owner=%U:%G' /etc/pxe-dashboard.env
  sed -E 's/^(PXE_ADMIN_PASSWORD_HASH=).*/\1<disamarkan>/' /etc/pxe-dashboard.env | grep -E '^[A-Z]'
  if grep -qE "^PXE_ADMIN_PASSWORD_HASH='scrypt\\$" /etc/pxe-dashboard.env; then echo "hash-format=scrypt"; else echo "hash-format=TIDAK-scrypt"; fi
  echo "env-file-sha256=$(sha256sum /etc/pxe-dashboard.env | cut -c1-16) mtime=$(stat -c %y /etc/pxe-dashboard.env)"
  echo "hash-sha256-prefix=$(sed -n 's/^PXE_ADMIN_PASSWORD_HASH=//p' /etc/pxe-dashboard.env | sha256sum | cut -c1-12)"
else echo "(tidak ada)"; fi
echo "# dnsmasq conf (interface/bind/range)"
grep -hE '^(interface|bind-interfaces|except-interface|dhcp-range|dhcp-boot|port)=?' /etc/dnsmasq.d/pxe-dashboard.conf 2>/dev/null || echo "(tidak ada)"
echo "# firewall nft"
if command -v nft >/dev/null 2>&1 && nft list table inet pxe_dashboard >/dev/null 2>&1; then
  echo "nft-table pxe_dashboard: ADA"; nft list table inet pxe_dashboard | sed 's/^/  /'
else echo "nft-table pxe_dashboard: tidak ada"; fi
printf 'pxe-dashboard-firewall %s %s\n' "$(systemctl is-active pxe-dashboard-firewall.service 2>/dev/null)" "$(systemctl is-enabled pxe-dashboard-firewall.service 2>/dev/null)"
echo "# nginx enabled"; ls -l /etc/nginx/sites-enabled 2>/dev/null | sed 1d
echo "# exportfs -v"; exportfs -v 2>/dev/null || true
echo "# klien NFS yang pernah dikenal nfsd (/proc/fs/nfsd/clients)"
for c in /proc/fs/nfsd/clients/*/info; do [[ -f "$c" ]] && grep -E '^(address|name|minor version):' "$c" | tr '\n' ' ' && echo; done 2>/dev/null
echo "nfsd-clients=$(ls /proc/fs/nfsd/clients 2>/dev/null | wc -l)"
echo "# mount /srv/pxe/media"; findmnt -rno TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null | grep '^/srv/pxe' || echo "(tidak ada)"
echo "# modul disk Debian (debian-netboot/modules)"
if [[ -d /srv/pxe/media/debian-netboot/modules ]]; then find /srv/pxe/media/debian-netboot/modules -name '*.ko' -printf 'ko %P %s\n'; else echo "(tidak ada)"; fi
echo "# fstab (baris /srv/pxe)"; grep '/srv/pxe' /etc/fstab || echo "(tidak ada)"
echo "# user pxe"; getent passwd pxe || echo "(tidak ada)"
echo "# data"
for d in /var/lib/pxe-dashboard /srv/pxe /srv/pxe/media /srv/pxe/tftp /var/log/dnsmasq-pxe.log; do
  if [[ -e "$d" ]]; then echo "ADA   $d $(stat -c '%a %U:%G' "$d")"; else echo "HILANG $d"; fi
done
ls -la /var/lib/pxe-dashboard 2>/dev/null | sed 1d
ls -la /srv/pxe/media 2>/dev/null | sed 1d
echo "# db"
[[ -f /var/lib/pxe-dashboard/pxe.db ]] && echo "pxe.db $(stat -c '%s byte, mtime %y' /var/lib/pxe-dashboard/pxe.db) sha256=$(sha256sum /var/lib/pxe-dashboard/pxe.db | cut -c1-16)"
echo "# curl lokal"
for u in /login /api/settings; do printf '%s %s\n' "$u" "$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://${SRV_IP:-10.99.0.2}$u" 2>&1)"; done
echo "# paket"; for p in dnsmasq nginx nfs-kernel-server ipxe; do printf '%-18s %s\n' "$p" "$(dpkg-query -W -f='${Status}' "$p" 2>/dev/null || echo absent)"; done
