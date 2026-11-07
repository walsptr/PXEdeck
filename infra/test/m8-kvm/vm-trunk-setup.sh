#!/usr/bin/env bash
# infra/test/m8-kvm/vm-trunk-setup.sh — DIJALANKAN DI VM pxe-test-install (root) lewat
# `ssh root@10.99.0.2 'bash -s' < vm-trunk-setup.sh` (M8 iterasi 2, mode VLAN, DEC-030 §4).
# Konfigurasi jaringan SERVER (bukan installer), setara server sungguhan yang sudah punya trunk:
#   trunk0  NIC ke-3 (MAC 52:54:00:99:01:04, network pxe-test-trunk -> switch lab M7) tanpa alamat
#   mgmt20  VLAN 20 10.99.20.1/24 (VLAN management node; gateway node + jalur relay SSH, seperti M7)
# VLAN PXE 10 (pxe10 10.99.10.2) TIDAK dibuat di sini: itu tugas install.sh --vlan-id 10.
set -euo pipefail
# 70-*: terurut SESUDAH nama netplan installer lama (60-) dan sebelum yang baru (99-): membuktikan
# perbaikan urutan file (temuan iterasi 2, iter2/vlan/install-1-netplan-order-diagnosis.txt).
f=/etc/netplan/70-m8-test-trunk.yaml
cat > "$f" <<'YAML'
# Uji M8 VLAN (test-engineer): trunk ke switch lab + VLAN management 20. Bukan file installer.
network:
  version: 2
  ethernets:
    trunk0:
      match:
        macaddress: "52:54:00:99:01:04"
      set-name: trunk0
      dhcp4: false
      dhcp6: false
      link-local: []
  vlans:
    mgmt20:
      id: 20
      link: trunk0
      addresses: [10.99.20.1/24]
      dhcp4: false
      dhcp6: false
      link-local: []
YAML
chmod 600 "$f"
netplan generate
netplan apply
for _ in $(seq 1 30); do ip -4 -o addr show dev mgmt20 2>/dev/null | grep -q ' 10.99.20.1/24 ' && break; sleep 1; done
ip -br link; ip -br addr
ip -4 -o addr show dev mgmt20 | grep -q ' 10.99.20.1/24 ' || { echo "mgmt20 tanpa 10.99.20.1/24" >&2; exit 1; }
echo "trunk-setup OK"
