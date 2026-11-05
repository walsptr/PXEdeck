#!/usr/bin/env bash
# infra/node.sh create|destroy <name> <mac> [uefi|bios]  |  infra/node.sh reset <name>
# VM node uji: qcow2 20G di .agent/vms/<name>.qcow2, 2 GB RAM, 2 vCPU, NIC pxe-test,
# --pxe --boot network,hd (UEFI: OVMF non-secure-boot). Serial console -> <runs>/<name>-console.log.
# Nama wajib ^pxe-test-, tidak boleh pxe-test-node01 / nama milik user.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

usage() { echo "pakai: $0 create|destroy <name> <mac> [uefi|bios] | reset <name>" >&2; exit 2; }
[[ $# -ge 2 ]] || usage
action="$1"; name="$2"; mac="${3:-}"; fw="${4:-uefi}"
assert_name "$name"
[[ "$name" == "$SERVER_NAME" || "$name" == pxe-test-server-* ]] && die "node.sh tidak untuk VM server"
disk="$VMS_DIR/$name.qcow2"
console="$RUNS_DIR/$name-console.log"
NODE_RAM_MB="${NODE_RAM_MB:-2048}"

case "$action" in
  create)
    [[ -n "$mac" ]] || usage
    assert_mac "$mac"
    [[ "$fw" == uefi || "$fw" == bios ]] || usage
    ensure_dirs
    assert_path_in_vms "$disk"
    if dom_exists "$name"; then
      if dom_running "$name"; then log "$name sudah berjalan"; exit 0; fi
      # VM lama yang mati: nyalakan listener serial dulu (append), lalu start.
      serial_capture_start "$(serial_port_for_mac "$mac")" "$console" append >/dev/null
      log "start $name (sudah ada)"; virsh_m start "$name"; exit 0
    fi
    net_active "$NET_PXE" || is_dry || die "network $NET_PXE belum aktif (net-up.sh)"
    run rm -f "$disk"
    run qemu-img create -q -f qcow2 "$disk" 20G
    serial_arg="$(serial_capture_start "$(serial_port_for_mac "$mac")" "$console")"
    boot="network,hd,bios.useserial=on"
    if [[ "$fw" == uefi ]]; then
      boot="network,hd,loader=$OVMF_CODE,loader.readonly=yes,loader.type=pflash,loader_secure=no,nvram.template=$OVMF_VARS"
    fi
    log "create $name ($fw, $mac, ${NODE_RAM_MB} MB)"
    run virt-install --connect "$VIRSH_URI" --name "$name" --memory "$NODE_RAM_MB" --vcpus 2 \
      --osinfo linux2022 \
      --disk "path=$disk,format=qcow2,bus=virtio" \
      --network "network=$NET_PXE,mac=$mac,model=virtio" \
      --pxe --boot "$boot" \
      --graphics none --noautoconsole --serial "$serial_arg"
    ;;
  reset)
    # Harness KVM (Playwright e2e-kvm): reboot paksa node yang berjalan agar PXE boot ulang
    # setelah Install di dashboard. Hanya satu VM node bernama, bukan server.
    dom_running "$name" || is_dry || die "$name tidak berjalan"
    log "reset $name"; virsh_m reset "$name"
    ;;
  destroy)
    if dom_exists "$name"; then
      if dom_running "$name"; then virsh_m destroy "$name"; fi
      if virsh_q dumpxml "$name" | grep -q '<nvram'; then
        virsh_m undefine --nvram "$name"
      else
        virsh_m undefine "$name"
      fi
    fi
    if [[ -n "$mac" ]]; then serial_capture_stop "$(serial_port_for_mac "$mac")"; fi
    if [[ -e "$disk" ]]; then assert_path_in_vms "$disk"; run rm -f "$disk"; fi
    log "$name dihapus"
    ;;
  *) usage ;;
esac
