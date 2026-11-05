#!/bin/bash
# Dijalankan cloud-init (runcmd, root) SATU KALI saat base disk pxe-test-server di-provision.
set -euo pipefail
exec > >(tee -a /var/log/pxe-provision.log) 2>&1
echo "== pxe provision start $(date -u +%FT%TZ)"

mkdir -p /srv/pxe/{tftp,boot} /srv/pxe/media/{ubuntu-24.04,debian-12,rocky-9,debian-netboot}
chown pxe:pxe /srv/pxe/tftp /srv/pxe/boot /srv/pxe/media/debian-netboot
chmod 755 /srv/pxe /srv/pxe/tftp /srv/pxe/boot

# dnsmasq: tunggu pxe0 punya alamat (bind-interfaces butuh interface sudah ada).
mkdir -p /etc/systemd/system/dnsmasq.service.d
cat > /etc/systemd/system/dnsmasq.service.d/pxe.conf <<'UNIT'
[Unit]
Wants=systemd-networkd-wait-online.service
After=systemd-networkd-wait-online.service
UNIT

# nginx: hanya site pxe (listen 10.99.0.2:80), buang default (0.0.0.0:80 / [::]:80).
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/pxe /etc/nginx/sites-enabled/pxe

# rpcbind UDP hanya di 10.99.0.2 (TCP tetap wildcard; dibatasi nftables di nat0).
echo 'OPTIONS="-w -h 10.99.0.2"' > /etc/default/rpcbind

# ISO media (CD-ROM) read-only.
grep -q 'pxe-test: ISO media' /etc/fstab || cat /etc/pxe-fstab.append >> /etc/fstab

systemctl daemon-reload
systemctl enable nftables
systemctl restart nftables
systemctl restart rpcbind || true
systemctl enable dnsmasq nginx nfs-server
systemctl restart dnsmasq nginx
mount -a || true
exportfs -ra || true
systemctl restart nfs-server

# Base selesai: cloud-init tidak dijalankan lagi pada overlay (konfigurasi sudah permanen).
touch /etc/cloud/cloud-init.disabled
echo "== pxe provision done $(date -u +%FT%TZ)"
touch /var/lib/pxe-provisioned
