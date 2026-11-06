#!/usr/bin/env bash
# infra/server-up.sh — jalankan VM pxe-test-server (overlay qcow2 di atas base), NIC1 pxe-test
# (10.99.0.2), NIC2 pxe-test-nat, ISO Ubuntu/Debian/Rocky sebagai CD-ROM read-only (DEC-009).
# Lalu salin file TFTP + Debian netboot dan verifikasi listen (gagal -> dnsmasq dihentikan).
# Idempoten: VM yang sudah ada di-start ulang/dibiarkan; overlay hanya dibuat bila VM belum ada.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

SERVER_RAM_MB="${SERVER_RAM_MB:-3072}"   # <= 3 GB agar node 2 GB muat (preflight: 9,5 GB)
ISO_UBUNTU="$MEDIA_DIR/ubuntu-24.04.5-live-server-amd64.iso"
ISO_DEBIAN="$MEDIA_DIR/debian-12.15.0-amd64-DVD-1.iso"
ISO_ROCKY="$MEDIA_DIR/Rocky-9-latest-x86_64-minimal.iso"
assert_name "$SERVER_NAME"
((SERVER_RAM_MB <= 3072)) || die "SERVER_RAM_MB maks 3072"
ensure_dirs

"$INFRA_DIR/server-base.sh"
"$INFRA_DIR/net-up.sh" >/dev/null
t0=$(date +%s)

if dom_exists "$SERVER_NAME"; then
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
    --network "network=$NET_PXE,mac=$SERVER_MAC_PXE,model=virtio" \
    --network "network=$NET_NAT,mac=$SERVER_MAC_NAT,model=virtio" \
    --graphics none --noautoconsole --serial "$serial_arg"
fi

wait_ssh 300 || die "SSH ke $SERVER_IP tidak siap"
log "SSH siap dalam $(( $(date +%s) - t0 ))s"

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
