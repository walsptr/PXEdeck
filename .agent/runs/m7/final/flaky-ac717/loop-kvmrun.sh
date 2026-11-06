#!/usr/bin/env bash
# Ulang kvm-run.sh <scenario> dry-run di sandbox harness; simpan OUT lengkap bila RC != 0.
set -euo pipefail
W=/home/syawal/Project/PXE-BOOT/.agent/wt-m7/infra/test
SC="$1"; N="$2"; DUMP="$3"
source "$W/harness.sh"
eval "$(awk '/^_build_safe_bin$/{exit} {print}' "$W/run.sh" | sed -n '/^source/!p' | grep -vE '^t ')"
eval "$(grep -vE '^t ' "$W/m7-infra.sh")"
_build_safe_bin
new_sandbox; _m7_vlan_sandbox; export INFRA_DRY_RUN=1
fails=0
for i in $(seq "$N"); do
  rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
  run_infra kvm-run.sh m7 --scenario "$SC"
  if [[ "$RC" != 0 ]]; then fails=$((fails+1)); { echo "=== iter $i RC=$RC"; echo "$OUT"; } >> "$DUMP"; fi
done
drop_sandbox; rm -rf "$SAFE_BIN"
echo "$SC: $fails/$N gagal"
