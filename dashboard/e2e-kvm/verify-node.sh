#!/usr/bin/env bash
# dashboard/e2e-kvm/verify-node.sh — verifikasi node hasil install (AC-4.31 / AC-4.33), dijalankan
# DI NODE lewat `ssh <user>@10.99.0.NN "EXPECT_...=... bash -s" < verify-node.sh` dengan key ed25519
# sekali pakai yang di-inject dashboard (infra/kvm-run.sh dan e2e-kvm/m4-install.spec.ts).
# Tidak menerima/mencetak password atau token. Keluaran: baris "OK ..." / "FAIL ..." + ringkasan;
# exit = jumlah FAIL (0 = lulus).
#
# Env wajib: EXPECT_HOSTNAME EXPECT_IP EXPECT_PREFIX EXPECT_MAC EXPECT_GW EXPECT_DNS EXPECT_USER
#            EXPECT_PUBKEY (satu baris public key OpenSSH)
# M6-T7 (SR-4-6/SR-4-7): "target bebas token" — /proc/cmdline, /etc/default/grub,
# /boot/grub*/grub.cfg, /boot/loader/entries/*.conf, /etc/kernel/cmdline, /root/anaconda-ks.cfg
# tidak boleh memuat /boot/<mac>/<token 43>; yang dicetak hanya JUMLAH cocok per file (isi/token
# tidak pernah dicetak). File root-only dibaca lewat `sudo -n cat` di node. Sisa SR-4-7(b)
# (/var/log/installer) sengaja tidak diasersi (dicatat di infra/README.md).
# Opsional (test infra): VERIFY_SCAN_ROOT=<dir> (prefix path, default "") dan
# VERIFY_ONLY=token-scan (hanya bagian bebas token, tanpa env EXPECT_*).
# M7 (docs/design/M7-plan.md §2.6, AC-7.18): EXPECT_VLAN=<id> opsional (dijalankan lewat relay
# infra/vlan/relay.sh di VM server). Bila ada: parent = interface ber-MAC EXPECT_MAC yang BUKAN
# perangkat VLAN; anak = perangkat `vlan protocol 802.1Q id EXPECT_VLAN` dengan link parent itu
# (dibaca dari `ip -d -o link`, bukan dari nama — mgmt.20/ens3.20/vlan20 semua sah); anak memuat
# EXPECT_IP/EXPECT_PREFIX; parent tanpa IPv4; tidak ada IPv4 di interface lain. Tanpa EXPECT_VLAN
# perilaku M6 identik.
set -uo pipefail
fails=0
ok() { printf 'OK   %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; fails=$((fails + 1)); }
check() { # check <label> <cond-exit>
  if [[ "$2" == 0 ]]; then ok "$1"; else bad "$1"; fi
}

# --- target bebas token (M6) ---
BOOTSEG_RE='/boot/[0-9a-fA-F:%-]{12,40}/[A-Za-z0-9_-]{43}([^A-Za-z0-9_-]|$)'
BOOTSCAN_PATHS=(/proc/cmdline /etc/default/grub /etc/kernel/cmdline /root/anaconda-ks.cfg /boot)
token_files() { # daftar file target (root-only dibaca/didaftar lewat sudo -n di node)
  local root="$1" pre=()
  [[ -z "$root" ]] && sudo -n true 2>/dev/null && pre=(sudo -n)
  local starts=() p
  for p in "${BOOTSCAN_PATHS[@]}"; do starts+=("$root$p"); done
  "${pre[@]}" find "${starts[@]}" -maxdepth 4 -type f \( -path "$root/proc/cmdline" \
    -o -path "$root/etc/default/grub" -o -path "$root/etc/kernel/cmdline" \
    -o -path "$root/root/anaconda-ks.cfg" -o -path "$root/boot/grub*/grub.cfg" \
    -o -path "$root/boot/efi/EFI/*/grub.cfg" -o -path "$root/boot/loader/entries/*.conf" \) 2>/dev/null | sort -u
}
token_scan() {
  local root="${VERIFY_SCAN_ROOT:-}" f n total=0 nfiles=0 rd=(cat)
  [[ -z "$root" ]] && sudo -n true 2>/dev/null && rd=(sudo -n cat)
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    n="$("${rd[@]}" "$f" 2>/dev/null | grep -Eoa "$BOOTSEG_RE" | wc -l)"
    nfiles=$((nfiles + 1)); total=$((total + n))
    [[ "$n" == 0 ]]; check "bebas token: ${f#"$root"} (cocok: $n)" $?
  done < <(token_files "$root")
  echo "# token-scan files=$nfiles matches=$total"
  ((nfiles > 0)); check "token-scan memeriksa >= 1 file (/proc/cmdline dll.)" $?
  [[ ! -e "$root/etc/pxe-callback" ]]; check "/etc/pxe-callback tidak ada" $?
}
if [[ "${VERIFY_ONLY:-}" == token-scan ]]; then
  token_scan
  echo "# verify-node fails=$fails"
  exit "$fails"
fi
for v in EXPECT_HOSTNAME EXPECT_IP EXPECT_PREFIX EXPECT_MAC EXPECT_GW EXPECT_DNS EXPECT_USER EXPECT_PUBKEY; do
  [[ -n "${!v:-}" ]] || { echo "FAIL env $v kosong"; exit 99; }
done

echo "# verify-node $(date -u +%FT%TZ) on $(hostname)"
echo "# uname: $(uname -r)"

# --- hostname ---
h="$(hostname)"
[[ "$h" == "$EXPECT_HOSTNAME" ]]; check "hostname = $EXPECT_HOSTNAME (aktual: $h)" $?

if [[ -z "${EXPECT_VLAN:-}" ]]; then
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

else
# --- M7: anak VLAN EXPECT_VLAN di parent ber-MAC EXPECT_MAC punya EXPECT_IP/EXPECT_PREFIX ---
[[ "$EXPECT_VLAN" =~ ^[0-9]{1,4}$ ]] || { echo "FAIL env EXPECT_VLAN tidak valid"; exit 99; }
# Baris `ip -d -o link`: "<idx>: <nama>[@<link>]: <...> ... link/ether <mac> ... [vlan protocol 802.1Q id <n>]"
links="$(ip -d -o link show 2>/dev/null)"
parent="$(awk -v mac="${EXPECT_MAC,,}" '{ n = $2; sub(/:$/, "", n); split(n, a, "@")
  m = ""; for (i = 1; i < NF; i++) if ($i == "link/ether") m = tolower($(i + 1))
  if (m == mac && $0 !~ / vlan protocol /) print a[1] }' <<<"$links" | head -n 1)"
[[ -n "$parent" ]]; check "parent NIC dengan MAC $EXPECT_MAC (bukan VLAN) ditemukan (${parent:-tidak ada})" $?
child="$(awk -v p="${parent:-x}" -v id="$EXPECT_VLAN" '{ n = $2; sub(/:$/, "", n); split(n, a, "@")
  if (a[2] == p && match($0, / vlan protocol 802\.1Q id [0-9]+/)) { v = substr($0, RSTART, RLENGTH); sub(/.* id /, "", v); if (v == id) print a[1] } }' <<<"$links" | head -n 1)"
[[ -n "$child" ]]; check "anak VLAN 802.1Q id $EXPECT_VLAN di $parent ditemukan (${child:-tidak ada})" $?
iface="${child:-}"
addrs="$(ip -4 -o addr show dev "${child:-lo}" 2>/dev/null | awk '{print $4}')"
echo "# ip -4 addr ($child): ${addrs//$'\n'/ }"
[[ -n "$child" ]] && grep -qx "$EXPECT_IP/$EXPECT_PREFIX" <<<"$addrs"; check "ip -4 addr $child memuat $EXPECT_IP/$EXPECT_PREFIX" $?
paddrs="$(ip -4 -o addr show dev "${parent:-lo}" 2>/dev/null | awk '{print $4}')"
[[ -n "$parent" && -z "$paddrs" ]]; check "parent $parent tanpa IPv4 (native VLAN PXE tidak dipakai OS; aktual: ${paddrs:-—})" $?
others="$(ip -4 -o addr show | awk '$2 != "lo" {print $2" "$4}' | grep -v "^${child:-x} " || true)"
[[ -z "$others" ]]; check "tidak ada IPv4 di interface lain selain $child (${others:-—})" $?
fi

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

# --- target bebas token (cmdline/bootloader/kickstart) ---
token_scan

# --- boot dari disk ---
root_src="$(findmnt -no SOURCE / 2>/dev/null)"
[[ "$root_src" == /dev/* ]]; check "root fs dari disk lokal ($root_src), bukan NFS/live" $?
echo "# uptime: $(uptime -p 2>/dev/null || true)"
echo "# verify-node fails=$fails"
exit "$fails"
