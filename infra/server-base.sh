#!/usr/bin/env bash
# infra/server-base.sh — provision SEKALI base disk .agent/vms/pxe-test-server-base.qcow2:
# Ubuntu 24.04 cloud image + cloud-init (cloud-localds): dnsmasq (hanya pxe0), nginx
# (10.99.0.2:80), nfs-kernel-server, nftables, Node 22 LTS (nodejs.org), user `pxe`
# (key .agent/keys/infra_ed25519). Idempoten: keluar bila base sudah siap (marker .ready).
# Paket apt diambil lewat NIC NAT (pxe-test-nat). VM sementara: pxe-test-server-base.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

BASE_VM="pxe-test-server-base"
BASE_SEED="$VMS_DIR/pxe-test-server-base-seed.iso"
READY="$VMS_DIR/pxe-test-server-base.ready"
SERVER_RAM_MB="${SERVER_RAM_MB:-3072}"
assert_name "$BASE_VM"
ensure_dirs

if [[ -f "$READY" && -f "$SERVER_BASE" ]]; then
  log "base $SERVER_BASE sudah di-provision ($(cat "$READY"))"
  exit 0
fi
dom_exists "$SERVER_NAME" && die "VM $SERVER_NAME masih terdefinisi; jalankan server-down.sh dulu"
[[ -f "$CLOUD_IMG" ]] || die "cloud image $CLOUD_IMG tidak ada"
command -v cloud-localds >/dev/null || die "cloud-localds tidak ada"

t0=$(date +%s)
ensure_key
NODE_TGZ="$("$INFRA_DIR/fetch-node.sh" | tail -1)"
"$INFRA_DIR/net-up.sh" >/dev/null

# Sisa run sebelumnya yang gagal.
if dom_exists "$BASE_VM"; then
  if dom_running "$BASE_VM"; then virsh_m destroy "$BASE_VM"; fi
  virsh_m undefine "$BASE_VM"
fi

assert_path_in_vms "$SERVER_BASE"
log "membuat base disk dari $(basename "$CLOUD_IMG")"
run rm -f "$SERVER_BASE"
run qemu-img convert -O qcow2 "$CLOUD_IMG" "$SERVER_BASE"
run qemu-img resize "$SERVER_BASE" 40G

# --- cloud-init seed -------------------------------------------------------------------
work="$(mktemp -d "$VMS_DIR/pxe-test-seed.XXXXXX")"
trap 'rm -rf "$work"' EXIT
b64() { base64 -w0 "$1"; }
pubkey="$(cat "$SSH_KEY.pub" 2>/dev/null || echo DRY-RUN-KEY)"
cat > "$work/meta-data" <<META
instance-id: pxe-test-server-base-1
local-hostname: pxe-test-server
META
cp "$INFRA_DIR/server/netplan.yaml" "$work/network-config"
cat > "$work/user-data" <<UD
#cloud-config
hostname: pxe-test-server
manage_etc_hosts: true
ssh_pwauth: false
disable_root: false
users:
  - name: $SERVER_USER
    gecos: PXE test server
    shell: /bin/bash
    groups: [adm]
    lock_passwd: true
    ssh_authorized_keys:
      - $pubkey
# Konfigurasi ditulis SEBELUM paket dipasang, agar dnsmasq tidak pernah start dengan
# konfigurasi default (DNS di semua interface).
write_files:
  # Admin VM uji ini: root key-only (PermitRootLogin prohibit-password default Ubuntu).
  - path: /root/.ssh/authorized_keys
    permissions: "0600"
    content: |
      $pubkey
  - path: /etc/dnsmasq.d/pxe.conf
    encoding: b64
    content: $(b64 "$INFRA_DIR/server/dnsmasq.conf")
  - path: /srv/pxe/tftp/.keep
    content: ""
  - path: /etc/nginx/sites-available/pxe
    encoding: b64
    content: $(b64 "$INFRA_DIR/server/nginx-pxe.conf")
  - path: /etc/nfs.conf.d/pxe.conf
    encoding: b64
    content: $(b64 "$INFRA_DIR/server/nfs.conf")
  - path: /etc/exports.d/pxe.exports
    encoding: b64
    content: $(b64 "$INFRA_DIR/server/exports")
  - path: /etc/nftables.conf
    encoding: b64
    content: $(b64 "$INFRA_DIR/server/nftables.conf")
  - path: /etc/pxe-fstab.append
    encoding: b64
    content: $(b64 "$INFRA_DIR/server/fstab.append")
  - path: /usr/local/sbin/pxe-provision-root.sh
    permissions: "0755"
    encoding: b64
    content: $(b64 "$INFRA_DIR/server/provision-root.sh")
package_update: true
package_upgrade: false
packages: [dnsmasq, nginx, nfs-kernel-server, nftables]
runcmd:
  - [/usr/local/sbin/pxe-provision-root.sh]
UD
run cloud-localds --network-config="$work/network-config" "$BASE_SEED" "$work/user-data" "$work/meta-data"

# --- boot VM sementara -----------------------------------------------------------------
serial_arg="$(serial_capture_start 45901 "$RUNS_DIR/$BASE_VM-serial.log")"
log "virt-install $BASE_VM (RAM ${SERVER_RAM_MB} MB)"
run virt-install --connect "$VIRSH_URI" --name "$BASE_VM" --memory "$SERVER_RAM_MB" --vcpus 2 \
  --osinfo linux2022 --import \
  --disk "path=$SERVER_BASE,format=qcow2,bus=virtio" \
  --disk "path=$BASE_SEED,device=cdrom,readonly=on" \
  --network "network=$NET_PXE,mac=$SERVER_MAC_PXE,model=virtio" \
  --network "network=$NET_NAT,mac=$SERVER_MAC_NAT,model=virtio" \
  --graphics none --noautoconsole --serial "$serial_arg"

log "menunggu SSH $SERVER_IP"
wait_ssh 600 || die "SSH ke $SERVER_IP tidak siap"
log "menunggu cloud-init selesai"
if ! is_dry; then
  for _ in $(seq 1 180); do
    ssh_root test -f /var/lib/pxe-provisioned && break
    sleep 5
  done
  ssh_root test -f /var/lib/pxe-provisioned || {
    ssh_root 'tail -50 /var/log/pxe-provision.log; tail -30 /var/log/cloud-init-output.log' || true
    die "provisioning cloud-init gagal/timeout"
  }
fi

log "memasang Node dari $(basename "$NODE_TGZ")"
scp_server "$NODE_TGZ" "/tmp/$(basename "$NODE_TGZ")"
ssh_root "NODE_TARBALL=/tmp/$(basename "$NODE_TGZ") bash -s" < "$INFRA_DIR/server/install-node.sh"

ssh_root 'cloud-init status --long | head -5; dpkg -l dnsmasq nginx nfs-kernel-server nftables | tail -4; node --version' \
  | tee "$RUNS_DIR/server-base-provision.txt"

log "mematikan $BASE_VM"
ssh_root 'sync; systemctl poweroff' || true
if ! is_dry; then
  for _ in $(seq 1 60); do dom_running "$BASE_VM" || break; sleep 2; done
  if dom_running "$BASE_VM"; then virsh_m destroy "$BASE_VM"; fi
fi
virsh_m undefine "$BASE_VM"
serial_capture_stop 45901
run rm -f "$BASE_SEED"
dur=$(( $(date +%s) - t0 ))
is_dry || echo "provisioned $(date -u +%FT%TZ) in ${dur}s node=$(basename "$NODE_TGZ")" > "$READY"
log "base siap dalam ${dur}s"
echo "provision_seconds=$dur" >> "$RUNS_DIR/server-base-provision.txt"
