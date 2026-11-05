#!/usr/bin/env bash
# infra/assert-server-logs.sh <runs-dir> <name=mac=fw[=userdata_min]> ...
# CR-4-12 (M5-T7, AC-5.36): asersi otomatis log server yang dikumpulkan kvm-run.sh
# (collect_evidence) di <runs-dir>:
#   - server-dnsmasq.txt: untuk setiap node UEFI, ada `DHCPACK(...) <ip> <mac>` dan
#     `sent .../snponly.efi to <ip>` untuk salah satu IP lease MAC itu (rantai OVMF -> iPXE).
#   - server-nginx.txt: `"GET /boot/<mac>/***/user-data" 200` minimal <userdata_min> kali (default 1;
#     node berperan destroy di M5 = 2: job pertama + install ulang).
# Hasil -> entri `results.json` (ac "CR-4-12-dnsmasq" / "CR-4-12-nginx", status PASS|FAIL)
# disisipkan ke array "results" (berkas dibuat bila belum ada) + ringkasan server-log-asserts.txt.
# Exit 0 bila semua PASS, 1 bila ada FAIL, 2 argumen salah. Hanya grep/sed/awk (PATH minimal).
set -euo pipefail
export LC_ALL=C

[[ $# -ge 2 ]] || { echo "pakai: $0 <runs-dir> <name=mac=fw[=userdata_min]> ..." >&2; exit 2; }
dir="$1"; shift
[[ -d "$dir" ]] || { echo "assert-server-logs: direktori '$dir' tidak ada" >&2; exit 2; }
dns="$dir/server-dnsmasq.txt"
ngx="$dir/server-nginx.txt"
res="$dir/results.json"
sum="$dir/server-log-asserts.txt"
: > "$sum"

entries=()
fail=0
add() { # add <ac> <node> <PASS|FAIL> <note> <evidence>
  local note="${4//\\/\\\\}"; note="${note//\"/\\\"}"
  entries+=("{\"ac\": \"$1\", \"node\": \"$2\", \"status\": \"$3\", \"note\": \"$note\", \"evidence\": [\"$5\"]}")
  printf '%-5s %-16s %-28s %s\n' "$3" "$1" "$2" "$4" >> "$sum"
  [[ "$3" == PASS ]] || fail=1
}

for spec in "$@"; do
  IFS='=' read -r name mac fw want <<<"$spec"
  want="${want:-1}"
  [[ "$name" =~ ^pxe-test-[a-z0-9-]+$ ]] || { echo "nama node '$name' tidak valid" >&2; exit 2; }
  [[ "$mac" =~ ^([0-9a-f]{2}:){5}[0-9a-f]{2}$ ]] || { echo "MAC '$mac' tidak valid" >&2; exit 2; }
  [[ "$fw" == uefi || "$fw" == bios ]] || { echo "firmware '$fw' tidak valid" >&2; exit 2; }
  [[ "$want" =~ ^[0-9]+$ ]] || { echo "userdata_min '$want' tidak valid" >&2; exit 2; }

  if [[ "$fw" == uefi ]]; then
    if [[ ! -f "$dns" ]]; then
      add CR-4-12-dnsmasq "$name" FAIL "server-dnsmasq.txt tidak ada" server-dnsmasq.txt
    else
      ips="$(grep -aE "DHCPACK\([^)]*\) [0-9.]+ $mac( |$)" "$dns" | awk '{for (i = 1; i < NF; i++) if ($i ~ /^DHCPACK\(/) print $(i + 1)}' | sort -u || true)"
      hit=""
      for ip in $ips; do
        if grep -aqE "sent [^ ]*/snponly\.efi to ${ip//./\\.}( |$)" "$dns"; then hit="$ip"; break; fi
      done
      if [[ -n "$hit" ]]; then
        add CR-4-12-dnsmasq "$name" PASS "TFTP snponly.efi terkirim ke $hit (lease $mac)" server-dnsmasq.txt
      else
        add CR-4-12-dnsmasq "$name" FAIL "tidak ada TFTP snponly.efi ke IP lease $mac (${ips//$'\n'/,})" server-dnsmasq.txt
      fi
    fi
  fi

  if [[ ! -f "$ngx" ]]; then
    add CR-4-12-nginx "$name" FAIL "server-nginx.txt tidak ada" server-nginx.txt
  else
    n="$(grep -acF "\"GET /boot/$mac/***/user-data\" 200 " "$ngx" || true)"
    if ((n >= want)); then
      add CR-4-12-nginx "$name" PASS "user-data 200 x$n (min $want)" server-nginx.txt
    else
      add CR-4-12-nginx "$name" FAIL "user-data 200 x$n (min $want)" server-nginx.txt
    fi
  fi
done

joined="$(IFS=,; echo "${entries[*]}")"
if [[ -f "$res" ]] && grep -q '"results": \[' "$res"; then
  if grep -q '"results": \[\]' "$res"; then
    sed -i "0,/\"results\": \[\]/s##\"results\": [$joined]#" "$res"
  else
    sed -i "0,/\"results\": \[/s##\"results\": [$joined, #" "$res"
  fi
else
  run="$(basename "$(dirname "$dir")")"
  printf '{\n  "run": "%s",\n  "generatedAt": "%s",\n  "results": [%s]\n}\n' "$run" "$(date -u +%FT%TZ)" "$joined" > "$res"
fi
cat "$sum" >&2
exit "$fail"
