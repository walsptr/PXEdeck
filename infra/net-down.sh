#!/usr/bin/env bash
# infra/net-down.sh [--topology flat|vlan] — hentikan + undefine network uji (hanya di akhir semua
# milestone / teardown M7-T12).
#   flat (default): pxe-test-nat, pxe-test.
#   vlan (M7): + pxe-test-port2, pxe-test-port1, pxe-test-trunk (kelimanya).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

topology=flat
while [[ $# -gt 0 ]]; do
  case "$1" in
    --topology) [[ $# -ge 2 ]] || die "--topology butuh nilai"; topology="$(parse_topology "$2")"; shift 2 ;;
    *) die "argumen tidak dikenal: $1 (pakai: net-down.sh [--topology flat|vlan])" ;;
  esac
done
nets=("$NET_NAT" "$NET_PXE")
[[ "$topology" == vlan ]] && nets=("$NET_PORT2" "$NET_PORT1" "$NET_TRUNK" "$NET_NAT" "$NET_PXE")

for net in "${nets[@]}"; do
  assert_name "$net"
  if net_active "$net"; then virsh_m net-destroy "$net"; fi
  if net_exists "$net"; then virsh_m net-undefine "$net"; fi
done
log "network ${nets[*]} dihapus"
