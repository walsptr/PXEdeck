#!/usr/bin/env bash
# infra/net-down.sh — hentikan + undefine pxe-test dan pxe-test-nat (hanya di akhir semua milestone).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

for net in "$NET_NAT" "$NET_PXE"; do
  assert_name "$net"
  if net_active "$net"; then virsh_m net-destroy "$net"; fi
  if net_exists "$net"; then virsh_m net-undefine "$net"; fi
done
log "network pxe-test* dihapus"
