#!/usr/bin/env bash
# infra/switch-base.sh — SEKALI: base disk VM pxe-test-switch (M7, docs/design/M7-plan.md §2.2) =
# cloud image Ubuntu 24.04 yang sudah ada di .agent/media (tanpa unduhan, tanpa boot, tanpa paket)
# -> .agent/vms/pxe-test-switch-base.qcow2 + marker .ready. Idempoten.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
assert_name "$SWITCH_NAME"
ensure_dirs

if [[ -f "$SWITCH_READY" && -f "$SWITCH_BASE" ]]; then
  log "base $SWITCH_BASE sudah siap ($(cat "$SWITCH_READY"))"
  exit 0
fi
dom_exists "$SWITCH_NAME" && die "VM $SWITCH_NAME masih terdefinisi; jalankan switch-down.sh --purge dulu"
[[ -f "$CLOUD_IMG" ]] || die "cloud image $CLOUD_IMG tidak ada"
assert_path_in_vms "$SWITCH_BASE"
log "membuat base switch dari $(basename "$CLOUD_IMG")"
run rm -f "$SWITCH_BASE" "$SWITCH_READY"
run qemu-img convert -O qcow2 "$CLOUD_IMG" "$SWITCH_BASE"
is_dry || echo "converted $(date -u +%FT%TZ) from $(basename "$CLOUD_IMG")" > "$SWITCH_READY"
log "base switch siap"
