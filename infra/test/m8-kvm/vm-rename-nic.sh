#!/usr/bin/env bash
# infra/test/m8-kvm/vm-rename-nic.sh — DIJALANKAN DI VM pxe-test-install (root) lewat
# `ssh root@10.99.0.2 'NEW=<nama> bash -s' < vm-rename-nic.sh`: ganti nama NIC lab pxe0 -> $NEW
# (konfigurasi VM uji saja, M8 KVM). Rename live (tanpa reboot; reboot dicoba dan NIC tetap pxe0 tanpa
# alamat): netplan cloud-init diedit (match MAC tetap), konfigurasi jaringan cloud-init dimatikan
# agar tidak dirender ulang, lalu di latar belakang: link down -> rename -> netplan apply.
set -euo pipefail
[[ "${NEW:-}" =~ ^[a-z][a-z0-9]{1,10}$ ]] || { echo "NEW tidak valid" >&2; exit 2; }
f="$(grep -rlE 'set-name: "?pxe0"?' /etc/netplan)"
[[ -n "$f" ]] || { echo "set-name pxe0 tidak ditemukan" >&2; exit 1; }
printf 'network: {config: disabled}\n' > /etc/cloud/cloud.cfg.d/99-m8-disable-network-config.cfg
sed -i -E "s/set-name: \"?pxe0\"?/set-name: \"$NEW\"/" $f
netplan generate
nohup bash -c "sleep 2; ip link set pxe0 down; ip link set pxe0 name $NEW; netplan apply" >/var/log/m8-rename-nic.log 2>&1 &
echo "rename $f pxe0 -> $NEW dijadwalkan"
