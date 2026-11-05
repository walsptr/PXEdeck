#!/usr/bin/env bash
# infra/smoke.sh <name> <mac> <uefi|bios> — smoke test rantai PXE tanpa dashboard:
# DHCP dari dnsmasq VM server -> (UEFI) TFTP snponly.efi -> iPXE GET /boot/<mac>.ipxe (statis).
# Bukti: <runs>/smoke/<name>-{console,dnsmasq,nginx}.txt + <name>-result.txt. Node dihapus di akhir.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
[[ $# -eq 3 ]] || { echo "pakai: $0 <name> <mac> <uefi|bios>" >&2; exit 2; }
name="$1"; mac="$2"; fw="$3"
assert_name "$name"; assert_mac "$mac"
out="$RUNS_DIR/smoke"; mkdir -p "$out"
timeout_s="${SMOKE_TIMEOUT:-240}"

dom_running "$SERVER_NAME" || die "$SERVER_NAME belum berjalan (server-up.sh)"
"$INFRA_DIR/node.sh" destroy "$name" "$mac" >/dev/null 2>&1 || true

# Script iPXE statis untuk MAC ini + offset log.
scp_server "$INFRA_DIR/smoke/boot-smoke.ipxe" "/srv/pxe/boot/$mac.ipxe"
dl0="$(ssh_root 'awk "END{print NR}" /var/log/dnsmasq-pxe.log')"
nl0="$(ssh_root 'awk "END{print NR}" /var/log/nginx/pxe-access.log')"

t0=$(date +%s)
cleanup_node() { "$INFRA_DIR/node.sh" destroy "$name" "$mac" >/dev/null 2>&1 || true; ssh_server "rm -f '/srv/pxe/boot/$mac.ipxe'" || true; }
trap cleanup_node EXIT
"$INFRA_DIR/node.sh" create "$name" "$mac" "$fw"
console="$RUNS_DIR/$name-console.log"

ok=0
for _ in $(seq 1 $((timeout_s / 3))); do
  if grep -aq 'PXE-SMOKE-OK' "$console" 2>/dev/null; then ok=1; break; fi
  sleep 3
done
dur=$(( $(date +%s) - t0 ))
sleep 2

# Bukti (teks): console tanpa escape ANSI, log dnsmasq & nginx sejak node dibuat.
sed -e 's/\x1b\[[0-9;?]*[A-Za-z]//g' -e 's/\r//g' "$console" | tr -cd '\11\12\40-\176' > "$out/$name-console.txt"
ssh_root "tail -n +$((dl0 + 1)) /var/log/dnsmasq-pxe.log" > "$out/$name-dnsmasq.txt"
ssh_root "tail -n +$((nl0 + 1)) /var/log/nginx/pxe-access.log" > "$out/$name-nginx.txt"

macre="${mac//:/(:|%3A|%3a)}"
check() { # check <label> <file> <regex>
  if grep -aEq "$3" "$2"; then echo "PASS $1"; else echo "FAIL $1"; return 1; fi
}
{
  echo "smoke $name mac=$mac firmware=$fw duration_s=$dur ipxe_script_reached=$ok"
  rc=0
  check "dhcp: DHCPACK dari dnsmasq VM server (pxe0) ke $mac" "$out/$name-dnsmasq.txt" "DHCPACK\(pxe0\) [0-9.]+ $mac" || rc=1
  check "dhcp: server-identifier = 10.99.0.2 (VM server)" "$out/$name-dnsmasq.txt" "option: 54 server-identifier +10\.99\.0\.2" || rc=1
  if [[ "$fw" == uefi ]]; then
    check "dhcp: bootfile snponly.efi ditawarkan (client-arch EFI)" "$out/$name-dnsmasq.txt" "option: 67 bootfile-name +snponly\.efi" || rc=1
    check "tftp: snponly.efi terkirim" "$out/$name-dnsmasq.txt" "sent /srv/pxe/tftp/snponly.efi to" || rc=1
  fi
  check "dhcp: user-class iPXE terdeteksi" "$out/$name-dnsmasq.txt" 'user class: iPXE' || rc=1
  check "dhcp: URL per-MAC diberikan ke iPXE" "$out/$name-dnsmasq.txt" 'option: 67 bootfile-name +http://10\.99\.0\.2/boot/\$\{mac\}\.ipxe' || rc=1
  check "http: iPXE GET /boot/<mac>.ipxe 200" "$out/$name-nginx.txt" "GET /boot/$macre\.ipxe\?platform=[a-z]+\" 200 .*iPXE" || rc=1
  check "console: script iPXE dieksekusi" "$out/$name-console.txt" "PXE-SMOKE-OK" || rc=1
  echo "RESULT: $([[ $rc == 0 ]] && echo PASS || echo FAIL)"
} | tee "$out/$name-result.txt"
grep -q 'RESULT: PASS' "$out/$name-result.txt"
