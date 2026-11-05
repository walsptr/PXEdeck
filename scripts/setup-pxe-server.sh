#!/usr/bin/env bash
# Setup PXE server Ubuntu 24.04 (dnsmasq + apache2 + autoinstall).
# Jalankan di PXE server dari root project (sebagai root):
#   PXE_PASSWORD_HASH="$(openssl passwd -6)" \
#   PXE_ADMIN_SSH_KEY="$(cat ~/.ssh/id_ed25519.pub)" bash scripts/setup-pxe-server.sh
# configs/autoinstall/user-data adalah TEMPLATE: placeholder @PXE_PASSWORD_HASH@ dan
# @PXE_ADMIN_SSH_KEY@ diisi dari env di langkah 7 (tidak ada hash/key di repo).
set -euo pipefail

: "${PXE_PASSWORD_HASH:?set PXE_PASSWORD_HASH (hash SHA-512 crypt, mis. openssl passwd -6)}"
: "${PXE_ADMIN_SSH_KEY:?set PXE_ADMIN_SSH_KEY (public key OpenSSH admin)}"
case "$PXE_PASSWORD_HASH" in
  '$6$'*) ;;
  *) echo 'PXE_PASSWORD_HASH harus hash SHA-512 crypt ($6$...)' >&2; exit 1 ;;
esac
case "$PXE_ADMIN_SSH_KEY" in
  *$'\n'*|*'"'*) echo "PXE_ADMIN_SSH_KEY harus satu baris tanpa tanda kutip" >&2; exit 1 ;;
  'ssh-ed25519 '*|'ssh-rsa '*|'ecdsa-sha2-nistp'*) ;;
  *) echo "PXE_ADMIN_SSH_KEY bukan public key OpenSSH" >&2; exit 1 ;;
esac
export PXE_PASSWORD_HASH PXE_ADMIN_SSH_KEY

# Render template user-data: ganti placeholder dari env (tanpa sed agar $ / & di
# hash tidak ditafsirkan).
render_user_data() {
  python3 - "$1" "$2" <<'PY'
import os, sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src).read()
for k in ("PXE_PASSWORD_HASH", "PXE_ADMIN_SSH_KEY"):
    text = text.replace("@%s@" % k, os.environ[k])
if "@PXE_" in text:
    sys.exit("placeholder belum terisi di " + src)
fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.write(fd, text.encode())
os.close(fd)
PY
}

ISO_NAME="ubuntu-24.04.5-live-server-amd64.iso"
ISO_URL="https://releases.ubuntu.com/24.04/${ISO_NAME}"
ISO_SHA256="97f3d7ffb032c3eb3b23d2c8be9cc76e60c2c1f2c0146ba5ba9fe01cafae0fd8"
SRC="$(cd "$(dirname "$0")/.." && pwd)/configs"
TFTP=/srv/pxe/tftp
HTTP=/srv/pxe/http

echo "[1/9] Netplan enp7s0 -> 10.10.10.1/24"
if ! cmp -s "$SRC/netplan/60-pxe.yaml" /etc/netplan/60-pxe.yaml; then
  install -m 600 "$SRC/netplan/60-pxe.yaml" /etc/netplan/60-pxe.yaml
  netplan apply
fi

echo "[2/9] Install paket"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nfs-kernel-server dnsmasq apache2 pxelinux syslinux-common shim-signed grub-efi-amd64-signed nftables wget

echo "[3/9] Struktur direktori"
mkdir -p "$TFTP"/{grub,pxelinux.cfg,ubuntu-24.04} "$HTTP"/{iso,autoinstall} /srv/pxe/iso /srv/pxe/nfs/ubuntu-24.04

echo "[4/9] Download & verifikasi ISO"
if [ ! -f "/srv/pxe/iso/$ISO_NAME" ]; then
  wget -q --show-progress -O "/srv/pxe/iso/$ISO_NAME" "$ISO_URL"
fi
echo "$ISO_SHA256  /srv/pxe/iso/$ISO_NAME" | sha256sum -c -
ln -sfn "/srv/pxe/iso/$ISO_NAME" "$HTTP/iso/$ISO_NAME"

echo "[5/9] Mount ISO permanen (fstab), export via NFS, ekstrak kernel & initrd"
MNT=/srv/pxe/nfs/ubuntu-24.04
grep -q "$MNT" /etc/fstab || echo "/srv/pxe/iso/$ISO_NAME $MNT iso9660 loop,ro,nofail 0 0" >> /etc/fstab
systemctl daemon-reload
mountpoint -q "$MNT" || mount "$MNT"
install -m 644 "$MNT/casper/vmlinuz" "$MNT/casper/initrd" "$TFTP/ubuntu-24.04/"
touch /etc/exports
install -D -m 644 "$SRC/nfs/exports" /etc/exports.d/pxe.exports
systemctl enable --now nfs-server
exportfs -ra

echo "[6/9] Bootloader BIOS (pxelinux) & UEFI (shim + grub)"
install -m 644 /usr/lib/PXELINUX/pxelinux.0 "$TFTP/"
for m in ldlinux.c32 libcom32.c32 libutil.c32 menu.c32; do
  install -m 644 "/usr/lib/syslinux/modules/bios/$m" "$TFTP/"
done
install -m 644 /usr/lib/shim/shimx64.efi.signed.latest "$TFTP/bootx64.efi"
install -m 644 /usr/lib/grub/x86_64-efi-signed/grubnetx64.efi.signed "$TFTP/grubx64.efi"
install -m 644 "$SRC/tftp/grub/grub.cfg" "$TFTP/grub/grub.cfg"
install -m 644 "$SRC/tftp/pxelinux.cfg/default" "$TFTP/pxelinux.cfg/default"

echo "[7/9] Autoinstall (HTTP) & Apache"
render_user_data "$SRC/autoinstall/user-data" "$HTTP/autoinstall/user-data"
install -m 644 "$SRC/autoinstall/meta-data" "$SRC/autoinstall/vendor-data" "$HTTP/autoinstall/"
install -m 644 "$SRC/apache/pxe.conf" /etc/apache2/conf-available/pxe.conf
a2enmod -q rewrite
a2enconf -q pxe
systemctl reload apache2

echo "[8/9] dnsmasq, IP forwarding & NAT"
install -m 644 "$SRC/dnsmasq/pxe.conf" /etc/dnsmasq.d/pxe.conf
[ -f /srv/pxe/dhcp-hosts ] || touch /srv/pxe/dhcp-hosts
echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-pxe-forward.conf
sysctl -q --system
install -m 755 "$SRC/nftables/nftables.conf" /etc/nftables.conf
systemctl enable --now nftables && systemctl restart nftables
dnsmasq --test
systemctl enable dnsmasq && systemctl restart dnsmasq

echo "[9/9] Tool inventaris node (pxe-nodes)"
install -m 755 "$(dirname "$SRC")/scripts/pxe-nodes" /usr/local/sbin/pxe-nodes
[ -f /srv/pxe/nodes.csv ] || install -m 644 "$SRC/nodes/nodes.csv.example" /srv/pxe/nodes.csv
pxe-nodes apply

echo "Selesai. Cek: systemctl status dnsmasq apache2; tail -f /var/log/dnsmasq-pxe.log"
