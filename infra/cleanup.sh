#!/usr/bin/env bash
# infra/cleanup.sh [run] [--server] [--switch] [--base]
# Hapus VM node milik run (^pxe-test-<run>-...) + disknya di .agent/vms/. Tidak pernah menyentuh
# pxe-test-node01, ubuntu24.04, default, int, atau network pxe-test*.
#   --server  matikan + undefine pxe-test-server dan hapus overlay-nya
#   --switch  (M7) matikan + undefine pxe-test-switch, hapus overlay + seed-nya (switch-down.sh --purge)
#   --base    hapus juga base disk pxe-test-server-base.qcow2 (provision ulang dibutuhkan); bersama
#             --switch juga base pxe-test-switch-base.qcow2
set -euo pipefail
source "$(dirname "$0")/lib.sh"

run_id="$PXE_RUN"; server=0; switch=0; base=0
for a in "$@"; do
  case "$a" in
    --server) server=1 ;;
    --switch) switch=1 ;;
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
# (VM/disk pxe-test-server*, network pxe-test-nat) ditolak sebelum virsh/rm apa pun. M7: juga
# pxe-test-switch* (VM/disk switch) dan network pxe-test-trunk/port*.
case "$run_id" in
  server*|nat*|switch*|trunk*|port*) die "run id '$run_id' bertabrakan dengan resource infra (pxe-test-server*/pxe-test-switch*/pxe-test-nat/pxe-test-trunk/pxe-test-port*)" ;;
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
  [[ "$dom" == "$SWITCH_NAME" || "$dom" == "$SWITCH_NAME"-* ]] && continue
  for p in "${PROTECTED_NAMES[@]}"; do [[ "$dom" == "$p" ]] && continue 2; done
  "$INFRA_DIR/node.sh" destroy "$dom"
done < <(virsh_q list --all --name)
# Disk yatim milik run.
shopt -s nullglob
for d in "$VMS_DIR/$prefix"*.qcow2; do
  # Disk infra (base/overlay server) tidak pernah termasuk disk run (CR-4-13).
  [[ "$(basename "$d")" == "$SERVER_NAME"* || "$(basename "$d")" == "$SWITCH_NAME"* ]] && continue
  assert_path_in_vms "$d"; run rm -f "$d"
done
# Password admin per run (M6, .agent/keys/<run>-admin.pass) + sisa cookie jar/key node run ini.
rm -f "$KEYS_DIR/$run_id-admin.pass" "$KEYS_DIR/pxe-test-$run_id-"*-session.jar
if ((server)); then "$INFRA_DIR/server-down.sh" --purge; fi
if ((switch)); then "$INFRA_DIR/switch-down.sh" --purge; fi
if ((base)); then
  run rm -f "$SERVER_BASE" "$VMS_DIR/pxe-test-server-base.ready"
  if ((switch)); then assert_path_in_vms "$SWITCH_BASE"; run rm -f "$SWITCH_BASE" "$SWITCH_READY"; fi
fi
is_dry || snapshot after
log "cleanup run $run_id selesai (lihat $rep)"
