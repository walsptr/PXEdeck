#!/usr/bin/env bash
# infra/install-vm.sh — VM uji BERSIH untuk install.sh/uninstall.sh (M8, DEC-029 §4).
#   up      buat VM pxe-test-install dari cloud image Ubuntu 24.04 (.agent/media) TANPA provisioning
#           lab (tanpa dnsmasq/nginx/NFS/Node/user pxe): hanya root key-only (.agent/keys/infra_ed25519),
#           NIC pxe0 di network terisolasi pxe-test (10.99.0.2/24, untuk SSH dari host + segmen PXE)
#           dan nat0 di pxe-test-nat (apt + nodejs.org, DEC-009). ISO Ubuntu/Debian/Rocky dipasang
#           sebagai CD-ROM read-only (/dev/sr0..sr2, urutan sama dengan server-up.sh); seed cloud-init
#           berupa disk virtio read-only agar urutan /dev/sr* tetap.
#   push [release.tar.xz]
#           salin checkout repo (file terlacak + belum terlacak non-ignored, tanpa .agent/) ke
#           /root/pxe-src di VM (lewat stdin ssh); opsional tarball rilis -> /root/pxe-release.tar.xz.
#   down    destroy + undefine pxe-test-install, hapus disk + seed-nya (hanya milik VM ini).
#   status  state VM.
# VM ini memakai IP 10.99.0.2 yang sama dengan pxe-test-server: `up` ditolak bila server lab berjalan.
# Env: INFRA_DRY_RUN=1, PXE_RUN (bukti di .agent/runs/<run>/kvm), INSTALL_VM_RAM_MB (default 4096,
# maks 4096: build Next di VM).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

VM="pxe-test-install"
DISK="$VMS_DIR/pxe-test-install.qcow2"
SEED="$VMS_DIR/pxe-test-install-seed.iso"
SERIAL_PORT=45903
RAM="${INSTALL_VM_RAM_MB:-4096}"
ISO_UBUNTU="$MEDIA_DIR/ubuntu-24.04.5-live-server-amd64.iso"
ISO_DEBIAN="$MEDIA_DIR/debian-12.15.0-amd64-DVD-1.iso"
ISO_ROCKY="$MEDIA_DIR/Rocky-9-latest-x86_64-minimal.iso"
assert_name "$VM"
[[ "$RAM" =~ ^[0-9]+$ ]] && ((RAM >= 2048 && RAM <= 4096)) || die "INSTALL_VM_RAM_MB harus 2048-4096"

cmd="${1:-}"; shift || true
case "$cmd" in
  up)
    (($# == 0)) || die "pakai: install-vm.sh up"
    dom_running "$SERVER_NAME" && die "$SERVER_NAME berjalan (IP $SERVER_IP sama); jalankan server-down.sh dulu"
    dom_exists "$VM" && die "$VM sudah ada; jalankan 'install-vm.sh down' dulu (VM harus bersih)"
    ensure_dirs
    ensure_key
    is_dry || [[ -f "$CLOUD_IMG" ]] || die "cloud image $CLOUD_IMG tidak ada"
    command -v cloud-localds >/dev/null || die "cloud-localds tidak ada"
    "$INFRA_DIR/net-up.sh" >/dev/null

    assert_path_in_vms "$DISK"
    assert_path_in_vms "$SEED"
    run rm -f "$DISK" "$SEED"
    run qemu-img convert -O qcow2 "$CLOUD_IMG" "$DISK"
    run qemu-img resize "$DISK" 30G

    work="$(mktemp -d "$VMS_DIR/pxe-test-seed.XXXXXX")"
    trap 'rm -rf "$work"' EXIT
    pubkey="$(cat "$SSH_KEY.pub" 2>/dev/null || echo DRY-RUN-KEY)"
    printf 'instance-id: pxe-test-install-%s\nlocal-hostname: pxe-test-install\n' "$(date -u +%Y%m%dT%H%M%SZ)" > "$work/meta-data"
    # Netplan lab yang sama (MAC 52:54:00:99:01:02 -> pxe0 10.99.0.2, :03 -> nat0 192.168.199.2).
    cp "$INFRA_DIR/server/netplan.yaml" "$work/network-config"
    cat > "$work/user-data" <<UD
#cloud-config
# VM uji BERSIH untuk install.sh: tanpa paket tambahan, tanpa user lab, tanpa konfigurasi PXE.
hostname: pxe-test-install
manage_etc_hosts: true
ssh_pwauth: false
disable_root: false
users: []
package_update: false
package_upgrade: false
write_files:
  - path: /root/.ssh/authorized_keys
    permissions: "0600"
    content: |
      $pubkey
runcmd:
  - [touch, /var/lib/pxe-test-install-ready]
UD
    run cloud-localds --network-config="$work/network-config" "$SEED" "$work/user-data" "$work/meta-data"

    cdroms=()
    for iso in "$ISO_UBUNTU" "$ISO_DEBIAN" "$ISO_ROCKY"; do
      if is_dry || [[ -f "$iso" ]]; then cdroms+=(--disk "path=$iso,device=cdrom,bus=sata,readonly=on")
      else die "ISO $iso tidak ada"; fi
    done
    serial_arg="$(serial_capture_start "$SERIAL_PORT" "$RUNS_DIR/$VM-serial.log")"
    log "virt-install $VM (RAM ${RAM} MB, cloud image bersih)"
    run virt-install --connect "$VIRSH_URI" --name "$VM" --memory "$RAM" --vcpus 2 \
      --osinfo linux2022 --import \
      --disk "path=$DISK,format=qcow2,bus=virtio" \
      --disk "path=$SEED,device=disk,bus=virtio,readonly=on" \
      "${cdroms[@]}" \
      --network "network=$NET_PXE,mac=$SERVER_MAC_PXE,model=virtio" \
      --network "network=$NET_NAT,mac=$SERVER_MAC_NAT,model=virtio" \
      --graphics none --noautoconsole --serial "$serial_arg"
    wait_ssh_host "root@$SERVER_IP" 600 || die "SSH root@$SERVER_IP tidak siap"
    if ! is_dry; then
      for _ in $(seq 1 120); do ssh_root test -f /var/lib/pxe-test-install-ready && break; sleep 5; done
      ssh_root 'cloud-init status --wait >/dev/null 2>&1 || true
        echo "# $(hostname) $(date -u +%FT%TZ)"; . /etc/os-release; echo "$PRETTY_NAME"
        ip -br addr; lsblk -o NAME,SIZE,TYPE,RO
        echo "# paket PXE (harus belum terpasang)"; for p in dnsmasq nginx nfs-kernel-server ipxe; do
          printf "%-18s %s\n" "$p" "$(dpkg-query -W -f="\${Status}" "$p" 2>/dev/null || echo absent)"; done
        echo "# node: $(command -v node || echo absent)"; getent passwd pxe || echo "user pxe: absent"' \
        > "$RUNS_DIR/install-vm-clean.txt" 2>&1 || true
    fi
    log "$VM siap: ssh -i $SSH_KEY root@$SERVER_IP (bukti $RUNS_DIR/install-vm-clean.txt)"
    ;;
  push)
    (($# <= 1)) || die "pakai: install-vm.sh push [release.tar.xz]"
    is_dry || dom_running "$VM" || die "$VM belum berjalan (install-vm.sh up)"
    tarf="$(mktemp "${TMPDIR:-/tmp}/pxe-test-src.XXXXXX")"
    trap 'rm -f "$tarf"' EXIT
    (cd "$REPO_DIR" && git ls-files -co --exclude-standard -z | grep -zv '^\.agent/' \
      | tar --null -T - -czf "$tarf")
    ssh_root 'rm -rf /root/pxe-src && mkdir -m 700 /root/pxe-src && tar -xzf - -C /root/pxe-src' < "$tarf"
    if (($# == 1)); then
      [[ -f "$1" ]] || die "tarball rilis $1 tidak ada"
      ssh_root 'umask 077 && cat > /root/pxe-release.tar.xz' < "$1"
    fi
    log "repo disalin ke root@$SERVER_IP:/root/pxe-src"
    ;;
  down)
    if dom_exists "$VM"; then
      dom_running "$VM" && virsh_m destroy "$VM"
      virsh_m undefine "$VM"
    fi
    serial_capture_stop "$SERIAL_PORT"
    assert_path_in_vms "$DISK"
    assert_path_in_vms "$SEED"
    run rm -f "$DISK" "$SEED"
    log "$VM dihapus"
    ;;
  status) virsh_q domstate "$VM" 2>/dev/null || echo "tidak ada" ;;
  *) die "pakai: install-vm.sh up|push [release.tar.xz]|down|status" ;;
esac
