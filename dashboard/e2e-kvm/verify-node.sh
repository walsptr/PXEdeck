#!/usr/bin/env bash
# dashboard/e2e-kvm/verify-node.sh — verifikasi node hasil install (AC-4.31 / AC-4.33), dijalankan
# DI NODE lewat `ssh <user>@10.99.0.NN "EXPECT_...=... bash -s" < verify-node.sh` dengan key ed25519
# sekali pakai yang di-inject dashboard (infra/kvm-run.sh dan e2e-kvm/m4-install.spec.ts).
# Tidak menerima/mencetak password atau token. Keluaran: baris "OK ..." / "FAIL ..." + ringkasan;
# exit = jumlah FAIL (0 = lulus).
#
# Env wajib: EXPECT_HOSTNAME EXPECT_IP EXPECT_PREFIX EXPECT_MAC EXPECT_GW EXPECT_DNS EXPECT_USER
#            EXPECT_PUBKEY (satu baris public key OpenSSH)
set -uo pipefail
fails=0
ok() { printf 'OK   %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; fails=$((fails + 1)); }
check() { # check <label> <cond-exit>
  if [[ "$2" == 0 ]]; then ok "$1"; else bad "$1"; fi
}
for v in EXPECT_HOSTNAME EXPECT_IP EXPECT_PREFIX EXPECT_MAC EXPECT_GW EXPECT_DNS EXPECT_USER EXPECT_PUBKEY; do
  [[ -n "${!v:-}" ]] || { echo "FAIL env $v kosong"; exit 99; }
done

echo "# verify-node $(date -u +%FT%TZ) on $(hostname)"
echo "# uname: $(uname -r)"

# --- hostname ---
h="$(hostname)"
[[ "$h" == "$EXPECT_HOSTNAME" ]]; check "hostname = $EXPECT_HOSTNAME (aktual: $h)" $?

# --- NIC ber-MAC EXPECT_MAC punya EXPECT_IP/EXPECT_PREFIX ---
iface=""
for d in /sys/class/net/*; do
  [[ "$(cat "$d/address" 2>/dev/null)" == "${EXPECT_MAC,,}" ]] && iface="$(basename "$d")"
done
[[ -n "$iface" ]]; check "NIC dengan MAC $EXPECT_MAC ditemukan (${iface:-tidak ada})" $?
addrs="$(ip -4 -o addr show dev "${iface:-lo}" 2>/dev/null | awk '{print $4}')"
echo "# ip -4 addr ($iface): ${addrs//$'\n'/ }"
grep -qx "$EXPECT_IP/$EXPECT_PREFIX" <<<"$addrs"; check "ip -4 addr $iface memuat $EXPECT_IP/$EXPECT_PREFIX" $?
others="$(ip -4 -o addr show | awk '$2 != "lo" {print $2" "$4}' | grep -v "^${iface:-x} " || true)"
[[ -z "$others" ]]; check "tidak ada IPv4 di NIC lain (${others:-—})" $?

# --- default route & DNS ---
gw="$(ip -4 route show default | awk '{print $3; exit}')"
[[ "$gw" == "$EXPECT_GW" ]]; check "default via $EXPECT_GW (aktual: ${gw:-—})" $?
dns="$( (resolvectl dns 2>/dev/null; grep -h '^nameserver' /etc/resolv.conf /run/systemd/resolve/resolv.conf 2>/dev/null) | tr -s ' ' '\n' | grep -E '^[0-9.]+$' | sort -u | tr '\n' ' ')"
grep -qw "$EXPECT_DNS" <<<"$dns"; check "DNS memuat $EXPECT_DNS (aktual: ${dns:-—})" $?

# --- user, sudo, authorized_keys ---
u="$(id -un)"
[[ "$u" == "$EXPECT_USER" ]]; check "login sebagai $EXPECT_USER (aktual: $u)" $?
sudo -n true 2>/dev/null; check "sudo -n true sukses (NOPASSWD)" $?
ak="$HOME/.ssh/authorized_keys"
if [[ -f "$ak" ]]; then
  lines="$(grep -cve '^\s*$' "$ak")"
  [[ "$lines" == 1 && "$(grep -ve '^\s*$' "$ak")" == "$EXPECT_PUBKEY" ]]; check "authorized_keys berisi persis key yang di-inject ($lines baris)" $?
  perm="$(stat -c '%a %U' "$ak")"
  [[ "$perm" == "600 $EXPECT_USER" ]]; check "authorized_keys 0600 milik $EXPECT_USER (aktual: $perm)" $?
else
  bad "authorized_keys tidak ada"
fi

# --- sshd: password login dinonaktifkan ---
pa="$(sudo -n sshd -T 2>/dev/null | awk '$1 == "passwordauthentication" {print $2}')"
[[ "$pa" == "no" ]]; check "sshd -T passwordauthentication no (aktual: ${pa:-—})" $?

# --- first-boot callback sudah membersihkan diri (token tidak tertinggal) ---
[[ ! -e /etc/pxe-callback && ! -e /usr/local/sbin/pxe-callback-done ]]; check "unit first-boot & URL callback sudah dihapus" $?
! systemctl is-enabled pxe-callback-done.service >/dev/null 2>&1; check "pxe-callback-done.service tidak aktif lagi" $?

# --- boot dari disk ---
root_src="$(findmnt -no SOURCE / 2>/dev/null)"
[[ "$root_src" == /dev/* ]]; check "root fs dari disk lokal ($root_src), bukan NFS/live" $?
echo "# uptime: $(uptime -p 2>/dev/null || true)"
echo "# verify-node fails=$fails"
exit "$fails"
