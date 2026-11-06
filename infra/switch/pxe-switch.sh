#!/bin/bash
# infra/switch/pxe-switch.sh — dijalankan DI DALAM VM pxe-test-switch (root VM; unit oneshot
# pxe-switch.service dan lewat `ssh root@10.99.0.3`). Mensimulasikan switch L2 ber-VLAN dengan
# Linux bridge br0 vlan_filtering=1 (M7, DEC-023 §2, docs/design/M7-plan.md §2.2). Tanpa alamat IP di
# br0 maupun port; NIC manajemen sw-mgmt (10.99.0.3) TIDAK masuk bridge.
#
#   Port    VLAN                                   Profil
#   sw-up   10 tagged, 20 tagged                   tetap (trunk ke pxe-test-server trunk0)
#   sw-p1   10 pvid untagged, 20 tagged            tetap (production DEC-023: PXE native + mgmt ber-tag)
#   sw-p2   access20: 20 pvid untagged (default)   apply-port sw-p2 <access20|tagged10>
#           tagged10: 10 tagged, tanpa PVID
#   br0 self: tanpa VLAN (vlan_default_pvid 0).
#
# Pakai: pxe-switch.sh apply | apply-port sw-p2 <access20|tagged10> | show | verify
#   apply       idempoten: buat/atur br0, masukkan sw-up/sw-p1/sw-p2, set VLAN sesuai tabel; profil
#               sw-p2 dari $PXE_SWITCH_CONF (SW_P2_PROFILE, default access20).
#   apply-port  ganti profil sw-p2 (disimpan ke $PXE_SWITCH_CONF). Profil/port lain -> exit 2.
#   show        bukti: bridge -d vlan show, ip -d link show br0, ip -s link.
#   verify      show + bandingkan tabel VLAN aktual dengan tabel di atas; beda -> exit 1.
set -euo pipefail
export LC_ALL=C

CONF="${PXE_SWITCH_CONF:-/etc/pxe-switch.conf}"
BR=br0
PORTS=(sw-up sw-p1 sw-p2)
VLAN_PXE=10
VLAN_MGMT=20

die() { echo "pxe-switch: $*" >&2; exit "${2:-1}"; }

# Profil sw-p2 dari file konfigurasi (bukan di-source: hanya baris SW_P2_PROFILE=<profil sah>).
p2_profile() {
  local p=""
  [[ -f "$CONF" ]] && p="$(sed -n 's/^SW_P2_PROFILE=\(access20\|tagged10\)[[:space:]]*$/\1/p' "$CONF" | tail -n 1)"
  echo "${p:-access20}"
}

# Tabel VLAN yang diharapkan: baris "<port> <vid> <flags>" (flags: pvid-untagged | tagged).
expected_table() {
  local prof="$1"
  printf '%s %s %s\n' sw-up "$VLAN_PXE" tagged sw-up "$VLAN_MGMT" tagged \
    sw-p1 "$VLAN_PXE" pvid-untagged sw-p1 "$VLAN_MGMT" tagged
  case "$prof" in
    access20) printf '%s %s %s\n' sw-p2 "$VLAN_MGMT" pvid-untagged ;;
    tagged10) printf '%s %s %s\n' sw-p2 "$VLAN_PXE" tagged ;;
  esac
}

# Tabel VLAN aktual dari `bridge vlan show` (format teks iproute2: baris port lalu baris lanjutan
# berawalan spasi; flag "PVID" dan "Egress Untagged"). Keluaran: "<dev> <vid> <flags>" terurut.
actual_table() {
  bridge vlan show 2>/dev/null | awk '
    /^port/ { next }
    NF == 0 { next }
    {
      if ($0 ~ /^[^ \t]/) { dev = $1; sub(/@.*/, "", dev); rest = substr($0, length($1) + 1) } else { rest = $0 }
      n = split(rest, f, /[ \t]+/); vid = ""; pvid = 0; untag = 0
      for (i = 1; i <= n; i++) {
        if (f[i] ~ /^[0-9]+$/ && vid == "") vid = f[i]
        if (f[i] == "PVID") pvid = 1
        if (f[i] == "Untagged") untag = 1
      }
      if (vid == "") next
      fl = (pvid && untag) ? "pvid-untagged" : (pvid ? "pvid-tagged" : (untag ? "untagged" : "tagged"))
      print dev, vid, fl
    }' | sort
}

port_vids() { # port_vids <dev> -> daftar vid yang terpasang di port
  actual_table | awk -v d="$1" '$1 == d { print $2 }'
}

port_reset() { # hapus semua VLAN dari port (idempoten)
  local dev="$1" v
  for v in $(port_vids "$dev"); do bridge vlan del dev "$dev" vid "$v"; done
}

port_profile() { # port_profile <dev> <profil>
  local dev="$1" prof="$2"
  port_reset "$dev"
  case "$prof" in
    trunk) bridge vlan add dev "$dev" vid "$VLAN_PXE"; bridge vlan add dev "$dev" vid "$VLAN_MGMT" ;;
    native10) bridge vlan add dev "$dev" vid "$VLAN_PXE" pvid untagged; bridge vlan add dev "$dev" vid "$VLAN_MGMT" ;;
    access20) bridge vlan add dev "$dev" vid "$VLAN_MGMT" pvid untagged ;;
    tagged10) bridge vlan add dev "$dev" vid "$VLAN_PXE" ;;
    *) die "profil '$prof' tidak dikenal" 2 ;;
  esac
}

disable_ipv6() { # tanpa alamat IPv6 link-local di br0/port (best effort; /proc tidak ada di test)
  local f="/proc/sys/net/ipv6/conf/$1/disable_ipv6"
  if [[ -w "$f" ]]; then echo 1 > "$f"; fi
}

cmd_apply() {
  local prof p
  prof="$(p2_profile)"
  if ip link show dev "$BR" >/dev/null 2>&1; then
    ip link set dev "$BR" type bridge vlan_filtering 1 vlan_default_pvid 0 stp_state 0
  else
    ip link add name "$BR" type bridge vlan_filtering 1 vlan_default_pvid 0 stp_state 0
  fi
  disable_ipv6 "$BR"
  ip addr flush dev "$BR"
  for p in "${PORTS[@]}"; do
    disable_ipv6 "$p"
    ip link set dev "$p" master "$BR"
    ip link set dev "$p" up
  done
  # br0 self tanpa VLAN (tidak ikut forwarding sebagai host).
  for p in $(port_vids "$BR"); do bridge vlan del dev "$BR" vid "$p" self; done
  port_profile sw-up trunk
  port_profile sw-p1 native10
  port_profile sw-p2 "$prof"
  ip link set dev "$BR" up
  echo "pxe-switch: apply OK (sw-p2=$prof)"
}

cmd_apply_port() {
  local dev="${1:-}" prof="${2:-}"
  [[ "$dev" == sw-p2 ]] || die "apply-port hanya untuk sw-p2 (bukan '$dev')" 2
  [[ "$prof" == access20 || "$prof" == tagged10 ]] || die "profil sw-p2 '$prof' harus access20|tagged10" 2
  port_profile sw-p2 "$prof"
  if [[ -f "$CONF" ]] && grep -q '^SW_P2_PROFILE=' "$CONF"; then
    sed -i "s/^SW_P2_PROFILE=.*/SW_P2_PROFILE=$prof/" "$CONF"
  else
    echo "SW_P2_PROFILE=$prof" >> "$CONF"
  fi
  echo "pxe-switch: sw-p2 -> $prof"
}

cmd_show() {
  echo "# pxe-switch show $(date -u +%FT%TZ) on $(hostname 2>/dev/null || echo ?)"
  echo "# profil sw-p2 (konfigurasi): $(p2_profile)"
  echo "# bridge -d vlan show"; bridge -d vlan show 2>&1 || true
  echo "# ip -d link show $BR"; ip -d link show dev "$BR" 2>&1 || true
  echo "# ip -br addr"; ip -br addr 2>&1 || true
  echo "# ip -s link"; ip -s link 2>&1 || true
}

cmd_verify() {
  local prof exp act bad=0 l p
  cmd_show
  prof="$(p2_profile)"
  exp="$(expected_table "$prof" | sort)"
  act="$(actual_table | grep -E '^(sw-up|sw-p1|sw-p2|br0) ' || true)"
  echo "# tabel VLAN diharapkan (sw-p2=$prof)"; echo "$exp"
  echo "# tabel VLAN aktual"; echo "${act:-(kosong)}"
  if [[ "$exp" == "$act" ]]; then echo "OK   tabel VLAN sesuai"; else echo "FAIL tabel VLAN berbeda"; bad=1; fi
  l="$(ip -d link show dev "$BR" 2>/dev/null || true)"
  if grep -q 'vlan_filtering 1' <<<"$l"; then echo "OK   $BR vlan_filtering 1"; else echo "FAIL $BR tanpa vlan_filtering 1"; bad=1; fi
  if grep -q 'vlan_default_pvid 0' <<<"$l"; then echo "OK   $BR vlan_default_pvid 0"; else echo "FAIL $BR vlan_default_pvid bukan 0"; bad=1; fi
  for p in "$BR" "${PORTS[@]}"; do
    if ip -4 -o addr show dev "$p" 2>/dev/null | grep -q inet; then echo "FAIL $p punya alamat IPv4"; bad=1; fi
  done
  for p in "${PORTS[@]}"; do
    if ip -o link show dev "$p" 2>/dev/null | grep -q "master $BR"; then echo "OK   $p master $BR"; else echo "FAIL $p bukan anggota $BR"; bad=1; fi
  done
  if ((bad)); then echo "RESULT: FAIL"; return 1; fi
  echo "RESULT: PASS"
}

case "${1:-}" in
  apply) cmd_apply ;;
  apply-port) shift; cmd_apply_port "$@" ;;
  show) cmd_show ;;
  verify) cmd_verify ;;
  *) die "pakai: $0 apply | apply-port sw-p2 <access20|tagged10> | show | verify" 2 ;;
esac
