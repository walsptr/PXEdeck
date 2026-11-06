#!/usr/bin/env bash
# infra/switch-down.sh [--purge] — matikan VM pxe-test-switch (M7; graceful, lalu destroy).
# --purge: undefine VM dan hapus overlay + seed (base tetap; base dihapus cleanup.sh --switch --base).
set -euo pipefail
source "$(dirname "$0")/lib.sh"
assert_name "$SWITCH_NAME"
purge=0
for a in "$@"; do
  case "$a" in
    --purge) purge=1 ;;
    *) die "opsi tidak dikenal: $a (pakai: switch-down.sh [--purge])" ;;
  esac
done

if dom_exists "$SWITCH_NAME"; then
  if dom_running "$SWITCH_NAME"; then
    virsh_m shutdown "$SWITCH_NAME" || true
    if ! is_dry; then for _ in $(seq 1 20); do dom_running "$SWITCH_NAME" || break; sleep 2; done; fi
    if dom_running "$SWITCH_NAME"; then virsh_m destroy "$SWITCH_NAME"; fi
  fi
  if ((purge)); then virsh_m undefine "$SWITCH_NAME"; fi
fi
serial_capture_stop "$SWITCH_SERIAL_PORT"
if ((purge)); then
  for f in "$SWITCH_DISK" "$SWITCH_SEED"; do
    if [[ -e "$f" ]]; then assert_path_in_vms "$f"; run rm -f "$f"; fi
  done
  log "$SWITCH_NAME dimatikan dan di-undefine (overlay + seed dihapus)"
else
  log "$SWITCH_NAME dimatikan"
fi
