#!/usr/bin/env bash
# infra/cleanup.sh [run] [--server] [--base]
# Hapus VM node milik run (^pxe-test-<run>-...) + disknya di .agent/vms/. Tidak pernah menyentuh
# pxe-test-node01, ubuntu24.04, default, int, atau network pxe-test*.
#   --server  matikan + undefine pxe-test-server dan hapus overlay-nya
#   --base    hapus juga base disk pxe-test-server-base.qcow2 (provision ulang dibutuhkan)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

run_id="$PXE_RUN"; server=0; base=0
for a in "$@"; do
  case "$a" in
    --server) server=1 ;;
    --base) base=1 ;;
    -*) die "opsi tidak dikenal: $a" ;;
    *) run_id="$a" ;;
  esac
done
# Nama terlindungi (default, int, ...) ditolak sebelum virsh apa pun dipanggil (AC-4.28).
for p in "${PROTECTED_NAMES[@]}"; do
  [[ "$run_id" == "$p" ]] && die "run id '$run_id' adalah nama terlindungi milik user"
done
[[ "$run_id" =~ ^[a-z0-9]+$ ]] || die "run id tidak valid: $run_id"
# CR-4-13: run id yang prefix-nya (pxe-test-<run>-) bertabrakan dengan resource infra
# (VM/disk pxe-test-server*, network pxe-test-nat) ditolak sebelum virsh/rm apa pun.
case "$run_id" in
  server*|nat*) die "run id '$run_id' bertabrakan dengan resource infra (pxe-test-server*/pxe-test-nat)" ;;
esac
ensure_dirs
rep="$RUNS_DIR/cleanup.txt"
snapshot() { { echo "## $1 $(date -u +%FT%TZ)"; virsh_q list --all; virsh_q net-list --all; ls -1 "$VMS_DIR"; } >> "$rep" 2>&1; }
is_dry || snapshot before

prefix="pxe-test-$run_id-"
while read -r dom; do
  [[ -z "$dom" ]] && continue
  [[ "$dom" == "$prefix"* ]] || continue
  [[ "$dom" == "$SERVER_NAME" || "$dom" == "$SERVER_NAME"-* ]] && continue
  for p in "${PROTECTED_NAMES[@]}"; do [[ "$dom" == "$p" ]] && continue 2; done
  "$INFRA_DIR/node.sh" destroy "$dom"
done < <(virsh_q list --all --name)
# Disk yatim milik run.
shopt -s nullglob
for d in "$VMS_DIR/$prefix"*.qcow2; do
  # Disk infra (base/overlay server) tidak pernah termasuk disk run (CR-4-13).
  [[ "$(basename "$d")" == "$SERVER_NAME"* ]] && continue
  assert_path_in_vms "$d"; run rm -f "$d"
done
if ((server)); then "$INFRA_DIR/server-down.sh" --purge; fi
if ((base)); then
  run rm -f "$SERVER_BASE" "$VMS_DIR/pxe-test-server-base.ready"
fi
is_dry || snapshot after
log "cleanup run $run_id selesai (lihat $rep)"
