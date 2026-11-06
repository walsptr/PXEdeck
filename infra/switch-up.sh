#!/usr/bin/env bash
# infra/switch-up.sh — jalankan VM pxe-test-switch (M7, DEC-024 O2-A, docs/design/M7-plan.md §2.2):
# overlay qcow2 di atas base (switch-base.sh) + seed cloud-init (root key-only, pxe-switch.sh +
# unit oneshot + /etc/pxe-switch.conf), 768 MB, 1 vCPU, 4 NIC:
#   sw-mgmt 52:54:00:99:02:01 pxe-test        (10.99.0.3/24, admin; tanpa gateway)
#   sw-up   52:54:00:99:02:02 pxe-test-trunk  (trunk ke server trunk0)
#   sw-p1   52:54:00:99:02:03 pxe-test-port1  (port node: VLAN 10 native, VLAN 20 ber-tag)
#   sw-p2   52:54:00:99:02:04 pxe-test-port2  (port uji negatif)
# TANPA NIC pxe-test-nat (switch tanpa internet). Serial -> <runs>/pxe-test-switch-serial.log.
# Setelah SSH siap: `pxe-switch.sh verify` -> <runs>/switch-check.txt (gagal -> exit 1).
# Wajib dijalankan SETELAH server-up.sh --topology vlan PASS (verify-listen-vlan.sh; O3).
# Idempoten: VM yang sudah ada dinyalakan/dibiarkan (konfigurasi diterapkan ulang).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

SWITCH_RAM_MB="${SWITCH_RAM_MB:-768}"
assert_name "$SWITCH_NAME"
((SWITCH_RAM_MB >= 512 && SWITCH_RAM_MB <= 1024)) || die "SWITCH_RAM_MB harus 512-1024"
for m in "$SWITCH_MAC_MGMT" "$SWITCH_MAC_UP" "$SWITCH_MAC_P1" "$SWITCH_MAC_P2"; do assert_mac "$m"; done
ensure_dirs
ensure_key

"$INFRA_DIR/switch-base.sh"
"$INFRA_DIR/net-up.sh" --topology vlan >/dev/null
t0=$(date +%s)
serial_log="$RUNS_DIR/$SWITCH_NAME-serial.log"

if dom_exists "$SWITCH_NAME"; then
  if dom_running "$SWITCH_NAME"; then log "$SWITCH_NAME sudah berjalan"
  else
    serial_capture_start "$SWITCH_SERIAL_PORT" "$serial_log" append >/dev/null
    log "start $SWITCH_NAME"; virsh_m start "$SWITCH_NAME"
  fi
else
  assert_path_in_vms "$SWITCH_DISK"
  assert_path_in_vms "$SWITCH_SEED"
  run rm -f "$SWITCH_DISK" "$SWITCH_SEED"
  run qemu-img create -q -f qcow2 -b "$SWITCH_BASE" -F qcow2 "$SWITCH_DISK"
  # --- seed cloud-init ---------------------------------------------------------------------
  work="$(mktemp -d "$VMS_DIR/pxe-test-switch-seed.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
  b64() { base64 -w0 "$1"; }
  pubkey="$(cat "$SSH_KEY.pub" 2>/dev/null || echo DRY-RUN-KEY)"
  cat > "$work/meta-data" <<META
instance-id: pxe-test-switch-$(date -u +%Y%m%d%H%M%S)
local-hostname: pxe-test-switch
META
  cp "$INFRA_DIR/switch/network-config.yaml" "$work/network-config"
  cat > "$work/user-data" <<UD
#cloud-config
hostname: pxe-test-switch
manage_etc_hosts: true
ssh_pwauth: false
disable_root: false
users: []
# Tanpa paket/apt: switch tidak punya NAT (DEC-024 O2-A).
package_update: false
package_upgrade: false
write_files:
  # Admin VM uji ini: root key-only (PermitRootLogin prohibit-password default Ubuntu).
  - path: /root/.ssh/authorized_keys
    permissions: "0600"
    content: |
      $pubkey
  - path: /usr/local/sbin/pxe-switch.sh
    permissions: "0755"
    encoding: b64
    content: $(b64 "$INFRA_DIR/switch/pxe-switch.sh")
  - path: /etc/pxe-switch.conf
    permissions: "0644"
    encoding: b64
    content: $(b64 "$INFRA_DIR/switch/pxe-switch.conf")
  - path: /etc/systemd/system/pxe-switch.service
    permissions: "0644"
    encoding: b64
    content: $(b64 "$INFRA_DIR/switch/pxe-switch.service")
runcmd:
  - [systemctl, daemon-reload]
  - [systemctl, enable, --now, pxe-switch.service]
  # Tanpa timer/apt di VM terisolasi.
  - [systemctl, disable, --now, apt-daily.timer, apt-daily-upgrade.timer, unattended-upgrades.service]
  - [touch, /var/lib/pxe-switch-ready]
UD
  run cloud-localds --network-config="$work/network-config" "$SWITCH_SEED" "$work/user-data" "$work/meta-data"
  serial_arg="$(serial_capture_start "$SWITCH_SERIAL_PORT" "$serial_log")"
  log "virt-install $SWITCH_NAME (RAM ${SWITCH_RAM_MB} MB, overlay $(basename "$SWITCH_DISK"))"
  run virt-install --connect "$VIRSH_URI" --name "$SWITCH_NAME" --memory "$SWITCH_RAM_MB" --vcpus 1 \
    --osinfo linux2022 --import \
    --disk "path=$SWITCH_DISK,format=qcow2,bus=virtio" \
    --disk "path=$SWITCH_SEED,device=cdrom,readonly=on" \
    --network "network=$NET_PXE,mac=$SWITCH_MAC_MGMT,model=virtio" \
    --network "network=$NET_TRUNK,mac=$SWITCH_MAC_UP,model=virtio" \
    --network "network=$NET_PORT1,mac=$SWITCH_MAC_P1,model=virtio" \
    --network "network=$NET_PORT2,mac=$SWITCH_MAC_P2,model=virtio" \
    --graphics none --noautoconsole --serial "$serial_arg"
fi

wait_ssh_host "root@$SWITCH_IP" 300 || die "SSH ke $SWITCH_IP tidak siap"
log "SSH switch siap dalam $(( $(date +%s) - t0 ))s"
if ! is_dry; then
  for _ in $(seq 1 60); do
    ssh_switch_root test -f /var/lib/pxe-switch-ready && break
    sleep 3
  done
fi
# Konfigurasi selalu diterapkan ulang (idempoten) dari repo, lalu diverifikasi.
ssh_switch_root 'cat > /usr/local/sbin/pxe-switch.sh && chmod 755 /usr/local/sbin/pxe-switch.sh' < "$INFRA_DIR/switch/pxe-switch.sh"
ssh_switch_root '/usr/local/sbin/pxe-switch.sh apply'
out="$RUNS_DIR/switch-check.txt"
if is_dry; then ssh_switch_root '/usr/local/sbin/pxe-switch.sh verify'; exit 0; fi
if ssh "${SSH_OPTS[@]}" "root@$SWITCH_IP" '/usr/local/sbin/pxe-switch.sh verify' > "$out" 2>&1; then
  log "switch-check PASS -> $out"
else
  log "switch-check FAIL -> $out"
  tail -20 "$out" >&2
  exit 1
fi
