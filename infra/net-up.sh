#!/usr/bin/env bash
# infra/net-up.sh [--topology flat|vlan] — define + start network uji. Idempoten; tidak autostart;
# tidak menyentuh network lain.
#   flat (default, M4–M6): pxe-test (isolated) dan pxe-test-nat (DEC-009).
#   vlan (M7, DEC-023 §3): + pxe-test-trunk, pxe-test-port1, pxe-test-port2 — XML WAJIB tanpa
#        <ip>, <forward>, <dhcp>; nama = nama file (^pxe-test-); bridge <= 15 karakter, unik,
#        bukan virbr-pxe/virbr-pxenat. XML yang melanggar ditolak SEBELUM virsh apa pun.
# Env uji: PXE_NET_XML_DIR (default infra/net) — hanya untuk test infra (XML sintetis).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

topology=flat
while [[ $# -gt 0 ]]; do
  case "$1" in
    --topology) [[ $# -ge 2 ]] || die "--topology butuh nilai"; topology="$(parse_topology "$2")"; shift 2 ;;
    *) die "argumen tidak dikenal: $1 (pakai: net-up.sh [--topology flat|vlan])" ;;
  esac
done
XML_DIR="${PXE_NET_XML_DIR:-$INFRA_DIR/net}"
if [[ "$topology" == vlan ]]; then nets=("${NETS_VLAN[@]}"); else nets=("${NETS_FLAT[@]}"); fi

# --- validasi semua XML dulu (tanpa virsh) --------------------------------------------------
declare -A seen_bridge=()
for net in "${nets[@]}"; do
  assert_name "$net"
  xml="$XML_DIR/$net.xml"
  [[ -f "$xml" ]] || die "XML $xml tidak ada"
  body="$(strip_xml_comments "$xml")"
  # sanity M4: network pxe-test* tidak boleh punya <dhcp>; pxe-test tanpa <forward>.
  grep -q '<dhcp' <<<"$body" && die "$xml memuat <dhcp>"
  if [[ "$net" == "$NET_PXE" ]] && grep -q '<forward' <<<"$body"; then die "$xml memuat <forward>"; fi
  name="$(sed -n "s:.*<name>[[:space:]]*\([^<]*\)[[:space:]]*</name>.*:\1:p" <<<"$body" | head -n 1)"
  [[ "$name" == "$net" ]] || die "$xml: <name> '$name' harus '$net'"
  br="$(sed -n "s:.*<bridge[^>]*name=['\"]\([^'\"]*\)['\"].*:\1:p" <<<"$body" | head -n 1)"
  [[ -n "$br" ]] || die "$xml tanpa <bridge name=...>"
  ((${#br} <= 15)) || die "$xml: bridge '$br' > 15 karakter"
  [[ -z "${seen_bridge[$br]:-}" ]] || die "$xml: bridge '$br' dipakai juga oleh ${seen_bridge[$br]}"
  seen_bridge[$br]="$net"
  grep -qiE '<interface|<pf |<hostdev|mode=.(bridge|passthrough|private|vepa|hostdev).' <<<"$body" \
    && die "$xml merujuk interface fisik"
  if [[ "$net" != "$NET_PXE" && "$net" != "$NET_NAT" ]]; then
    # Network VLAN M7: terisolasi total, host tanpa alamat L3.
    grep -q '<ip' <<<"$body" && die "$xml memuat <ip> (network VLAN M7 wajib tanpa alamat host)"
    grep -q '<forward' <<<"$body" && die "$xml memuat <forward> (network VLAN M7 wajib terisolasi)"
    [[ "$br" != virbr-pxe && "$br" != virbr-pxenat ]] || die "$xml: bridge '$br' bentrok dengan network M4–M6"
  fi
done

for net in "${nets[@]}"; do
  xml="$XML_DIR/$net.xml"
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
