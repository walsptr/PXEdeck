#!/usr/bin/env bash
# infra/net-up.sh — define + start network pxe-test (isolated) dan pxe-test-nat (DEC-009).
# Idempoten; tidak autostart; tidak menyentuh network lain.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

for net in "$NET_PXE" "$NET_NAT"; do
  assert_name "$net"
  xml="$INFRA_DIR/net/$net.xml"
  [[ -f "$xml" ]] || die "XML $xml tidak ada"
  # sanity: XML pxe-test tidak boleh punya <dhcp> atau <forward>
  grep -v '^\s*<!--' "$xml" | grep -q '<dhcp' && die "$xml memuat <dhcp>"
  if [[ "$net" == "$NET_PXE" ]] && grep -v '^\s*<!--' "$xml" | grep -q '<forward'; then die "$xml memuat <forward>"; fi
  if net_exists "$net"; then
    log "network $net sudah terdefinisi"
  else
    virsh_m net-define "$xml"
  fi
  if net_active "$net"; then
    log "network $net sudah aktif"
  else
    virsh_m net-start "$net"
  fi
done
is_dry || virsh_q net-list --all
