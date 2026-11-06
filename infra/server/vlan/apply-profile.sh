#!/bin/bash
# infra/server/vlan/apply-profile.sh — dijalankan DI DALAM VM pxe-test-server sebagai root VM
# (`ssh root@10.99.0.2 'STAGE=/tmp/pxe-test-vlan.<ts> bash -s' < apply-profile.sh`, dipanggil
# infra/server-up.sh --topology vlan). Memasang profil VLAN M7 (docs/design/M7-plan.md §2.3) dari
# file yang sebelumnya di-scp ke $STAGE:
#   netplan-vlan.yaml dnsmasq-vlan.conf nginx-pxe-vlan.conf exports-vlan nfs-vlan.conf sysctl-vlan.conf
# Urutan: dnsmasq DIHENTIKAN dulu -> trunk0 (rename NIC ber-MAC 52:54:00:99:01:04) + pxe10/mgmt20 ->
# ip_forward=0 -> dnsmasq hanya pxe10 -> nginx 10.99.0.2:80 + 10.99.10.2:80 (nginx -t) -> NFS ro
# 10.99.10.0/24 + 10.99.20.0/24, nfsd/rpcbind 10.99.10.2 -> log dnsmasq dipotong -> dnsmasq start.
# Verifikasi listen TIDAK di sini: infra/server/vlan/verify-listen-vlan.sh (gagal -> dnsmasq stop).
# Idempoten. Gagal di langkah mana pun -> exit ≠ 0 dengan dnsmasq tetap mati.
set -euo pipefail
: "${STAGE:?}"
[[ "$STAGE" =~ ^/tmp/pxe-test-vlan\.[0-9]{8}T[0-9]{6}Z$ ]] || { echo "STAGE tidak valid" >&2; exit 1; }
TRUNK_MAC="52:54:00:99:01:04"
files=(netplan-vlan.yaml dnsmasq-vlan.conf nginx-pxe-vlan.conf exports-vlan nfs-vlan.conf sysctl-vlan.conf)
for f in "${files[@]}"; do [[ -f "$STAGE/$f" ]] || { echo "FAIL $STAGE/$f tidak ada" >&2; exit 1; }; done
trap 'rm -rf "$STAGE"' EXIT

echo "# apply-profile vlan $(date -u +%FT%TZ) on $(hostname)"
# 1) Tidak ada DHCP selama profil berganti (jendela flat O3-A ditutup secepatnya).
systemctl stop dnsmasq
echo "OK   dnsmasq dihentikan"

# 2) Network: rename NIC trunk -> trunk0 (rename hanya bisa saat link down), lalu netplan.
cur=""
for d in /sys/class/net/*; do
  [[ "$(cat "$d/address" 2>/dev/null)" == "$TRUNK_MAC" ]] && cur="$(basename "$d")"
done
[[ -n "$cur" ]] || { echo "FAIL NIC trunk ($TRUNK_MAC) tidak ada — VM dibuat tanpa network pxe-test-trunk?" >&2; exit 1; }
if [[ "$cur" != trunk0 ]]; then
  ip link set dev "$cur" down
  ip link set dev "$cur" name trunk0
  echo "OK   $cur -> trunk0"
fi
install -m 0600 "$STAGE/netplan-vlan.yaml" /etc/netplan/60-pxe-vlan.yaml
netplan generate
netplan apply
for _ in $(seq 1 30); do
  ip -4 -o addr show dev pxe10 2>/dev/null | grep -q ' 10\.99\.10\.2/24 ' \
    && ip -4 -o addr show dev mgmt20 2>/dev/null | grep -q ' 10\.99\.20\.1/24 ' && break
  sleep 1
done
ip -4 -o addr show dev pxe10 | grep -q ' 10\.99\.10\.2/24 ' || { echo "FAIL pxe10 tanpa 10.99.10.2/24" >&2; exit 1; }
ip -4 -o addr show dev mgmt20 | grep -q ' 10\.99\.20\.1/24 ' || { echo "FAIL mgmt20 tanpa 10.99.20.1/24" >&2; exit 1; }
echo "OK   pxe10 10.99.10.2/24, mgmt20 10.99.20.1/24 di trunk0"

# 3) Bukan router.
install -m 0644 "$STAGE/sysctl-vlan.conf" /etc/sysctl.d/90-pxe-vlan.conf
sysctl -q -p /etc/sysctl.d/90-pxe-vlan.conf
[[ "$(cat /proc/sys/net/ipv4/ip_forward)" == 0 ]] || { echo "FAIL ip_forward bukan 0" >&2; exit 1; }
echo "OK   net.ipv4.ip_forward=0"

# 4) dnsmasq hanya pxe10 (dijalankan di langkah terakhir).
install -m 0644 "$STAGE/dnsmasq-vlan.conf" /etc/dnsmasq.d/pxe.conf
dnsmasq --test -C /etc/dnsmasq.d/pxe.conf

# 5) nginx admin + VLAN PXE.
install -m 0644 "$STAGE/nginx-pxe-vlan.conf" /etc/nginx/sites-available/pxe
ln -sf /etc/nginx/sites-available/pxe /etc/nginx/sites-enabled/pxe
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
echo "OK   nginx dimuat ulang (10.99.0.2:80 + 10.99.10.2:80)"

# 6) NFS read-only VLAN 10 + 20, nfsd/rpcbind hanya 10.99.10.2.
install -m 0644 "$STAGE/nfs-vlan.conf" /etc/nfs.conf.d/pxe.conf
install -m 0644 "$STAGE/exports-vlan" /etc/exports.d/pxe.exports
echo 'OPTIONS="-w -h 10.99.10.2"' > /etc/default/rpcbind
mount -a 2>/dev/null || true
systemctl restart rpcbind
systemctl restart nfs-server
exportfs -ra
echo "OK   NFS: $(exportfs -s 2>/dev/null | tr '\n' ' ' | tr -s ' ')"

# 7) Bukti dnsmasq dimulai setelah profil aktif.
: > /var/log/dnsmasq-pxe.log
systemctl start dnsmasq
echo "OK   dnsmasq dijalankan (interface=pxe10)"
echo "RESULT: APPLIED"
