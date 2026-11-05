#!/usr/bin/env bash
# infra/assert-server-logs.sh <runs-dir> <name=mac=fw[=min[=file]]> ...
# CR-4-12 (M5-T7, AC-5.36): asersi otomatis log server yang dikumpulkan kvm-run.sh
# (collect_evidence) di <runs-dir>:
#   - server-dnsmasq.txt: untuk setiap node UEFI, ada `DHCPACK(...) <ip> <mac>` dan
#     `sent .../snponly.efi to <ip>` untuk salah satu IP lease MAC itu (rantai OVMF -> iPXE).
#   - server-nginx.txt: `"GET /boot/<mac>/***/<file>" 200` minimal <min> kali (default 1; node
#     berperan destroy/failpath = 2: job pertama + install ulang). <file> default `user-data`
#     (Ubuntu); M6: `preseed.cfg` (Debian), `ks.cfg` (Rocky).
# CR-5-10 (M6-T7): hasil ditulis ke server-log-asserts.json (array JSON, di-escape oleh modul json
# lewat infra/results-json.py, bukan sed) lalu digabung ke array "results" di results.json (dibuat
# bila belum ada; results.json tak valid dipindah, bukan ditimpa diam-diam) + ringkasan teks
# server-log-asserts.txt. Exit 0 bila semua PASS, 1 bila ada FAIL, 2 argumen salah.
set -euo pipefail
export LC_ALL=C

[[ $# -ge 2 ]] || { echo "pakai: $0 <runs-dir> <name=mac=fw[=userdata_min]> ..." >&2; exit 2; }
dir="$1"; shift
[[ -d "$dir" ]] || { echo "assert-server-logs: direktori '$dir' tidak ada" >&2; exit 2; }
dns="$dir/server-dnsmasq.txt"
ngx="$dir/server-nginx.txt"
res="$dir/results.json"
sum="$dir/server-log-asserts.txt"
js="$dir/server-log-asserts.json"
tsv="$dir/.server-log-asserts.tsv"
RJ=(python3 -I "$(cd "$(dirname "$0")" && pwd)/results-json.py")
: > "$sum"; : > "$tsv"

fail=0
add() { # add <ac> <node> <PASS|FAIL> <note> <evidence>
  local note="${4//$'\t'/ }"; note="${note//$'\n'/ }"
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$note" "$5" >> "$tsv"
  printf '%-5s %-16s %-28s %s\n' "$3" "$1" "$2" "$4" >> "$sum"
  [[ "$3" == PASS ]] || fail=1
}

for spec in "$@"; do
  IFS='=' read -r name mac fw want file <<<"$spec"
  want="${want:-1}"; file="${file:-user-data}"
  [[ "$name" =~ ^pxe-test-[a-z0-9-]+$ ]] || { echo "nama node '$name' tidak valid" >&2; exit 2; }
  [[ "$mac" =~ ^([0-9a-f]{2}:){5}[0-9a-f]{2}$ ]] || { echo "MAC '$mac' tidak valid" >&2; exit 2; }
  [[ "$fw" == uefi || "$fw" == bios ]] || { echo "firmware '$fw' tidak valid" >&2; exit 2; }
  [[ "$want" =~ ^[0-9]+$ ]] || { echo "userdata_min '$want' tidak valid" >&2; exit 2; }
  [[ "$file" =~ ^(user-data|preseed\.cfg|ks\.cfg)$ ]] || { echo "file konfigurasi '$file' tidak valid" >&2; exit 2; }

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
    n="$(grep -acF "\"GET /boot/$mac/***/$file\" 200 " "$ngx" || true)"
    if ((n >= want)); then
      add CR-4-12-nginx "$name" PASS "$file 200 x$n (min $want)" server-nginx.txt
    else
      add CR-4-12-nginx "$name" FAIL "$file 200 x$n (min $want)" server-nginx.txt
    fi
  fi
done

"${RJ[@]}" tsv-entries "$tsv" "$js"
rm -f "$tsv"
run="${PXE_RESULTS_RUN:-$(basename "$(dirname "$dir")")}"
"${RJ[@]}" add "$res" "$run" "$js"
cat "$sum" >&2
exit "$fail"
