#!/usr/bin/env bash
# driver: jalankan satu fungsi test infra N kali (definisi dari run.sh + m7-infra.sh, tanpa baris `t` top-level)
set -euo pipefail
W=/home/syawal/Project/PXE-BOOT/.agent/wt-m7/infra/test
FN="$1"; N="${2:-10}"
source "$W/harness.sh"
eval "$(sed -n '/^unq()/p;/^MUTATE_VERBS=/p' "$W/run.sh")"
eval "$(awk '/^_build_safe_bin$/{exit} {print}' "$W/run.sh" | sed -n '/^source/!p' | grep -vE '^t ')"
eval "$(grep -vE '^t ' "$W/m7-infra.sh")"
_build_safe_bin
for i in $(seq "$N"); do t "$FN #$i" "$FN"; done
rm -rf "$SAFE_BIN"
echo "hasil: $PASS lulus, $FAIL gagal"
