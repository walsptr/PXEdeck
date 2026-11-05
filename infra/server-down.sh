#!/usr/bin/env bash
# infra/server-down.sh [--purge] — matikan VM pxe-test-server (graceful, lalu destroy).
# --purge: undefine VM dan hapus overlay pxe-test-server.qcow2 (base tetap).
set -euo pipefail
source "$(dirname "$0")/lib.sh"
assert_name "$SERVER_NAME"
purge=0; [[ "${1:-}" == "--purge" ]] && purge=1

if dom_exists "$SERVER_NAME"; then
  if dom_running "$SERVER_NAME"; then
    virsh_m shutdown "$SERVER_NAME" || true
    if ! is_dry; then for _ in $(seq 1 30); do dom_running "$SERVER_NAME" || break; sleep 2; done; fi
    if dom_running "$SERVER_NAME"; then virsh_m destroy "$SERVER_NAME"; fi
  fi
  if ((purge)); then virsh_m undefine "$SERVER_NAME"; fi
fi
serial_capture_stop 45900
if ((purge)) && [[ -e "$SERVER_DISK" ]]; then
  assert_path_in_vms "$SERVER_DISK"
  run rm -f "$SERVER_DISK"
fi
if ((purge)); then log "$SERVER_NAME dimatikan dan di-undefine (overlay dihapus)"; else log "$SERVER_NAME dimatikan"; fi
