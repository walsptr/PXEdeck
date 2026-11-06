#!/usr/bin/env bash
# infra/server-up.sh — jalankan VM pxe-test-server (overlay qcow2 di atas base), NIC1 pxe-test
# (10.99.0.2), NIC2 pxe-test-nat, ISO Ubuntu/Debian/Rocky sebagai CD-ROM read-only (DEC-009).
# Lalu salin file TFTP + Debian netboot dan verifikasi listen (gagal -> dnsmasq dihentikan).
# Idempoten: VM yang sudah ada di-start ulang/dibiarkan; overlay hanya dibuat bila VM belum ada.
#
# --topology flat (default): perilaku M4–M6 utuh (dnsmasq di pxe0, verify-listen.sh).
# --topology vlan (M7, docs/design/M7-plan.md §2.3): NIC ketiga trunk0 di network pxe-test-trunk
#   (MAC 52:54:00:99:01:04); setelah SSH siap dnsmasq dihentikan, file TFTP/media disalin, lalu
#   infra/server/vlan/apply-profile.sh (root VM) memasang pxe10 (VLAN 10, 10.99.10.2) + mgmt20
#   (VLAN 20, 10.99.20.1), dnsmasq hanya pxe10, nginx 10.99.0.2:80 + 10.99.10.2:80, NFS ro VLAN 10+20,
#   ip_forward=0; lalu infra/server/vlan/verify-listen-vlan.sh -> <runs>/server-listen-vlan.txt
#   (gagal -> dnsmasq dihentikan, exit 1). Switch/node hanya boleh dibuat setelah PASS (O3).
#   VM yang sudah ada dengan topologi lain ditolak (server-down.sh --purge dulu).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

topology=flat
while [[ $# -gt 0 ]]; do
  case "$1" in
    --topology) [[ $# -ge 2 ]] || die "--topology butuh nilai"; topology="$(parse_topology "$2")"; shift 2 ;;
    *) die "argumen tidak dikenal: $1 (pakai: server-up.sh [--topology flat|vlan])" ;;
  esac
done

SERVER_RAM_MB="${SERVER_RAM_MB:-3072}"   # <= 3 GB agar node 2 GB muat (preflight: 9,5 GB)
ISO_UBUNTU="$MEDIA_DIR/ubuntu-24.04.5-live-server-amd64.iso"
ISO_DEBIAN="$MEDIA_DIR/debian-12.15.0-amd64-DVD-1.iso"
ISO_ROCKY="$MEDIA_DIR/Rocky-9-latest-x86_64-minimal.iso"
assert_name "$SERVER_NAME"
((SERVER_RAM_MB <= 3072)) || die "SERVER_RAM_MB maks 3072"
ensure_dirs

"$INFRA_DIR/server-base.sh"
"$INFRA_DIR/net-up.sh" --topology "$topology" >/dev/null
t0=$(date +%s)
net_args=(--network "network=$NET_PXE,mac=$SERVER_MAC_PXE,model=virtio"
  --network "network=$NET_NAT,mac=$SERVER_MAC_NAT,model=virtio")
[[ "$topology" == vlan ]] && net_args+=(--network "network=$NET_TRUNK,mac=$SERVER_MAC_TRUNK,model=virtio")

if dom_exists "$SERVER_NAME"; then
  # VM lama harus bertopologi sama (NIC trunk ada <=> vlan); selain itu profil dnsmasq salah.
  if ! is_dry; then
    has_trunk=0
    [[ "$(virsh_q dumpxml "$SERVER_NAME" 2>/dev/null || true)" == *"$SERVER_MAC_TRUNK"* ]] && has_trunk=1
    if [[ "$topology" == vlan ]] && ((!has_trunk)); then
      die "$SERVER_NAME sudah ada tanpa NIC trunk ($SERVER_MAC_TRUNK); jalankan server-down.sh --purge dulu"
    fi
    if [[ "$topology" == flat ]] && ((has_trunk)); then
      die "$SERVER_NAME sudah ada dengan topologi vlan; jalankan server-down.sh --purge dulu"
    fi
  fi
  if dom_running "$SERVER_NAME"; then log "$SERVER_NAME sudah berjalan"
  else
    # Listener socat serial harus hidup sebelum QEMU connect (chardev mode=connect).
    serial_capture_start 45900 "$RUNS_DIR/$SERVER_NAME-serial.log" append >/dev/null
    log "start $SERVER_NAME"; virsh_m start "$SERVER_NAME"
  fi
else
  for iso in "$ISO_UBUNTU" "$ISO_DEBIAN" "$ISO_ROCKY"; do [[ -f "$iso" ]] || die "ISO $iso tidak ada"; done
  assert_path_in_vms "$SERVER_DISK"
  run rm -f "$SERVER_DISK"
  run qemu-img create -q -f qcow2 -b "$SERVER_BASE" -F qcow2 "$SERVER_DISK"
  serial_arg="$(serial_capture_start 45900 "$RUNS_DIR/$SERVER_NAME-serial.log")"
  log "virt-install $SERVER_NAME (RAM ${SERVER_RAM_MB} MB, overlay $(basename "$SERVER_DISK"))"
  # Urutan CD-ROM = /dev/sr0..2 di VM = fstab: Ubuntu, Debian, Rocky.
  run virt-install --connect "$VIRSH_URI" --name "$SERVER_NAME" --memory "$SERVER_RAM_MB" --vcpus 2 \
    --osinfo linux2022 --import \
    --disk "path=$SERVER_DISK,format=qcow2,bus=virtio" \
    --disk "path=$ISO_UBUNTU,device=cdrom,bus=sata,readonly=on" \
    --disk "path=$ISO_DEBIAN,device=cdrom,bus=sata,readonly=on" \
    --disk "path=$ISO_ROCKY,device=cdrom,bus=sata,readonly=on" \
    "${net_args[@]}" \
    --graphics none --noautoconsole --serial "$serial_arg"
fi

wait_ssh 300 || die "SSH ke $SERVER_IP tidak siap"
log "SSH siap dalam $(( $(date +%s) - t0 ))s"
# VLAN (O3-A): dnsmasq base (profil flat di pxe0) dihentikan secepatnya; segmen admin belum berisi
# node/switch pada titik ini. Baru dinyalakan lagi oleh apply-profile.sh dengan interface=pxe10.
[[ "$topology" == vlan ]] && ssh_root 'systemctl stop dnsmasq'

# File TFTP (iPXE) + Debian netboot (milik user pxe di VM, tanpa root).
"$INFRA_DIR/tftp/prepare.sh" >/dev/null
scp_server "$INFRA_DIR/tftp/snponly.efi" "$INFRA_DIR/tftp/undionly.kpxe" /srv/pxe/tftp/
if [[ -f "$MEDIA_DIR/debian-netboot/linux" ]]; then
  scp_server "$MEDIA_DIR/debian-netboot/linux" "$MEDIA_DIR/debian-netboot/initrd.gz" /srv/pxe/media/debian-netboot/
  # BUG-M6-8: driver disk virtio untuk d-i netboot (tidak ada di initrd netboot maupun pool DVD-1)
  # disalin dari initrd DVD (kver sama) → http://$SERVER_IP/media/debian-netboot/modules/<kver>/.
  # Biner .ko hanya di .agent/vms (gitignored), bukan di bukti .agent/runs (di-commit).
  mod_dir="$VMS_DIR/pxe-test-debian-disk-modules"
  assert_path_in_vms "$mod_dir"
  run rm -rf "$mod_dir"
  run "$INFRA_DIR/server/debian-disk-modules.sh" "$ISO_DEBIAN" "$MEDIA_DIR/debian-netboot/initrd.gz" "$mod_dir"
  ssh_root "install -d -o pxe -g pxe /srv/pxe/media/debian-netboot/modules"
  run scp -r "${SSH_OPTS[@]}" "$mod_dir/." "$SERVER_USER@$SERVER_IP:/srv/pxe/media/debian-netboot/modules/"
fi
# O11-C / DEC-018 §2 (cadangan, hanya bila smoke membuktikan paket kurang): repo tambahan yang
# sudah diunduh host dari mirror resmi + diverifikasi ke .agent/media/extra-<nama>/ disajikan
# nginx sebagai http://10.99.0.2/media/extra-<nama>/ (node tetap tanpa NAT). Tidak ada = dilewati.
shopt -s nullglob
for xd in "$MEDIA_DIR"/extra-*/; do
  xn="$(basename "$xd")"
  [[ "$xn" =~ ^extra-[a-z0-9][a-z0-9.-]*$ ]] || die "nama repo tambahan '$xn' tidak valid"
  ssh_root "install -d -o pxe -g pxe /srv/pxe/media/$xn"
  run scp -r "${SSH_OPTS[@]}" "${xd%/}/." "$SERVER_USER@$SERVER_IP:/srv/pxe/media/$xn/"
  log "repo tambahan $xn disajikan di http://$SERVER_IP/media/$xn/"
done
shopt -u nullglob
if [[ "$topology" == vlan ]]; then
  # Profil VLAN: file konfigurasi di-scp (user pxe) ke stage, dipasang root VM oleh apply-profile.sh.
  vstage="/tmp/pxe-test-vlan.$(date -u +%Y%m%dT%H%M%SZ)"
  ssh_server "mkdir -m 700 '$vstage'"
  scp_server "$INFRA_DIR/server/vlan/netplan-vlan.yaml" "$INFRA_DIR/server/vlan/dnsmasq-vlan.conf" \
    "$INFRA_DIR/server/vlan/nginx-pxe-vlan.conf" "$INFRA_DIR/server/vlan/exports-vlan" \
    "$INFRA_DIR/server/vlan/nfs-vlan.conf" "$INFRA_DIR/server/vlan/sysctl-vlan.conf" "$vstage/"
  ssh_root "STAGE=$vstage bash -s" < "$INFRA_DIR/server/vlan/apply-profile.sh" \
    || { ssh_root 'systemctl stop dnsmasq' || true; die "apply-profile.sh (profil VLAN) gagal; dnsmasq dihentikan"; }
  out="$RUNS_DIR/server-listen-vlan.txt"
  if is_dry; then ssh_root 'bash -s' < "$INFRA_DIR/server/vlan/verify-listen-vlan.sh"; exit 0; fi
  if ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'bash -s' < "$INFRA_DIR/server/vlan/verify-listen-vlan.sh" > "$out" 2>&1; then
    log "verifikasi listen VLAN PASS -> $out"
  else
    log "verifikasi listen VLAN FAIL -> $out (dnsmasq dihentikan)"
    tail -20 "$out" >&2
    exit 1
  fi
  exit 0
fi

# Ekspor NFS selalu diperbarui dari repo (base VM di-cache; DEC-020 menambah stage2 Rocky). Hanya
# read-only + 10.99.0.0/24 (diasersi infra/test/m6.sh).
ssh_root 'cat > /etc/exports.d/pxe.exports' < "$INFRA_DIR/server/exports"
ssh_root 'mount -a 2>/dev/null; exportfs -ra; systemctl restart dnsmasq' || true

out="$RUNS_DIR/server-listen.txt"
if is_dry; then ssh_root 'bash -s' < "$INFRA_DIR/server/verify-listen.sh"; exit 0; fi
if ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'bash -s' < "$INFRA_DIR/server/verify-listen.sh" > "$out" 2>&1; then
  log "verifikasi listen PASS -> $out"
else
  log "verifikasi listen FAIL -> $out (dnsmasq dihentikan)"
  tail -20 "$out" >&2
  exit 1
fi
