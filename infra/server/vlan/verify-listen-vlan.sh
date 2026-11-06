#!/bin/bash
# infra/server/vlan/verify-listen-vlan.sh — dijalankan DI DALAM VM pxe-test-server (root VM, via
# ssh_root 'bash -s') setelah apply-profile.sh (M7, docs/design/M7-plan.md §2.3 langkah 3, DEC-023 §3).
# Memastikan:
#   - dnsmasq HANYA di pxe10 (10.99.10.2 / %pxe10; port 67/69/53) — tidak di pxe0, mgmt20, nat0,
#     10.99.0.2, 10.99.20.1, atau wildcard tanpa device (0.0.0.0:67);
#   - nginx tepat 10.99.0.2:80 dan 10.99.10.2:80;
#   - nfsd hanya 10.99.10.2:2049;
#   - tidak ada socket selain sshd di 10.99.20.1 / NIC NAT 192.168.199.*;
#   - net.ipv4.ip_forward=0; nftables guard nat0 aktif; dnsmasq/nginx/nfs-server aktif;
#   - pxe10 = VLAN 802.1Q id 10 dan mgmt20 = id 20 di atas trunk0; trunk0 tanpa IPv4.
# Pelanggaran -> `systemctl stop dnsmasq`, exit 1 (switch/node tidak boleh dibuat; O3).
# Env uji (test infra, ss/ip/systemctl/nft palsu): PXE_VERIFY_PROC (default /proc),
# PXE_VERIFY_DNSMASQ_CONF (default /etc/dnsmasq.d/pxe.conf).
set -uo pipefail
PROC="${PXE_VERIFY_PROC:-/proc}"
DNSMASQ_CONF="${PXE_VERIFY_DNSMASQ_CONF:-/etc/dnsmasq.d/pxe.conf}"
echo "# ss -lunp  ($(date -u +%FT%TZ), $(hostname 2>/dev/null || echo ?))"
ss -lunp
echo
echo "# ss -lntp"
ss -lntp
echo
echo "# ip -br addr"; ip -br addr
echo
echo "# ip -d link show (trunk0 pxe10 mgmt20)"
for d in trunk0 pxe10 mgmt20; do ip -d link show dev "$d" 2>&1; done
echo
echo "# services"; for s in dnsmasq nginx nfs-server nftables rpcbind; do printf '%-12s %s\n' "$s" "$(systemctl is-active "$s")"; done
echo
echo "# mounts"; findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null | grep /srv/pxe || echo "(tidak ada ISO ter-mount)"
echo
echo "# exports"; exportfs -s 2>&1 || true
echo
echo "# tftp root"; (cd /srv/pxe/tftp 2>/dev/null && sha256sum snponly.efi undionly.kpxe 2>&1) || echo "(tidak ada)"
echo
echo "# nft ruleset"; nft list ruleset
echo

bad=0
ok() { echo "OK   $*"; }
fail() { echo "FAIL $*"; bad=1; }
dns_ok() { [[ "$1" == 10.99.10.2:* || "$1" == *%pxe10:* ]]; }
nginx_seen=""; nfs_seen=0
# Kolom ss -lntupH: Netid State Recv-Q Send-Q Local Peer [Process]
while read -r netid state rq sq local peer proc; do
  [[ -z "${local:-}" ]] && continue
  port="${local##*:}"
  case "$proc" in
    *'"dnsmasq"'*)
      if dns_ok "$local"; then ok "dnsmasq $netid $local"
      else fail "dnsmasq $netid $local (harus 10.99.10.2 / %pxe10)"; fi ;;
    *'"nginx"'*)
      if [[ "$local" == 10.99.0.2:80 || "$local" == 10.99.10.2:80 ]]; then
        ok "nginx $netid $local"; nginx_seen+=" $local"
      else fail "nginx $netid $local (harus 10.99.0.2:80 / 10.99.10.2:80)"; fi ;;
  esac
  if [[ "$port" == 2049 ]]; then
    if [[ "$local" == 10.99.10.2:2049 ]]; then ok "nfsd $netid $local"; nfs_seen=1
    else fail "nfsd $netid $local (harus 10.99.10.2:2049)"; fi
  fi
  if [[ "$local" == 10.99.20.1:* || "$local" == *%mgmt20:* || "$local" == 192.168.199.* || "$local" == *%nat0:* ]]; then
    case "$proc" in *'"sshd"'*) ;; *) fail "$netid $local $proc (tidak boleh listen di mgmt20/nat0)" ;; esac
  fi
  if [[ "$local" == *%pxe0:* ]]; then
    case "$proc" in *'"sshd"'*) ;; *) fail "$netid $local $proc (tidak boleh terikat device pxe0)" ;; esac
  fi
done < <(ss -lntupH)
for l in 10.99.0.2:80 10.99.10.2:80; do
  [[ " $nginx_seen " == *" $l "* ]] || fail "nginx tidak listen $l"
done
((nfs_seen)) || fail "nfsd tidak listen 10.99.10.2:2049"

fwd="$(cat "$PROC/sys/net/ipv4/ip_forward" 2>/dev/null || echo '?')"
if [[ "$fwd" == 0 ]]; then ok "net.ipv4.ip_forward=0"; else fail "net.ipv4.ip_forward=$fwd (harus 0)"; fi

# VLAN: dibaca dari `ip -d -o link` (id + link), bukan dari nama saja.
vlan_ok() { # vlan_ok <dev> <id>
  local l; l="$(ip -d -o link show dev "$1" 2>/dev/null || true)"
  [[ "$l" == *"$1@trunk0:"* && "$l" =~ vlan\ protocol\ 802\.1Q\ id\ $2([^0-9]|$) ]]
}
if vlan_ok pxe10 10; then ok "pxe10 = VLAN 802.1Q id 10 di trunk0"; else fail "pxe10 bukan VLAN id 10 di trunk0"; fi
if vlan_ok mgmt20 20; then ok "mgmt20 = VLAN 802.1Q id 20 di trunk0"; else fail "mgmt20 bukan VLAN id 20 di trunk0"; fi
a="$(ip -4 -o addr show dev pxe10 2>/dev/null || true)"
[[ "$a" == *" 10.99.10.2/24 "* ]] && ok "pxe10 10.99.10.2/24" || fail "pxe10 tanpa 10.99.10.2/24"
a="$(ip -4 -o addr show dev mgmt20 2>/dev/null || true)"
[[ "$a" == *" 10.99.20.1/24 "* ]] && ok "mgmt20 10.99.20.1/24" || fail "mgmt20 tanpa 10.99.20.1/24"
a="$(ip -4 -o addr show dev trunk0 2>/dev/null || true)"
[[ -z "$a" ]] && ok "trunk0 tanpa IPv4" || fail "trunk0 punya IPv4: $a"

if nft list ruleset 2>/dev/null | grep -q 'iifname "nat0" counter packets [0-9]* bytes [0-9]* drop'; then
  ok "nftables: koneksi baru dari nat0 di-drop"
else
  fail "nftables guard nat0 tidak aktif"
fi
for s in dnsmasq nginx nfs-server; do
  [[ "$(systemctl is-active "$s")" == active ]] || fail "$s tidak aktif"
done
if grep -qx 'interface=pxe10' "$DNSMASQ_CONF" 2>/dev/null; then ok "$DNSMASQ_CONF interface=pxe10"
else fail "$DNSMASQ_CONF bukan profil VLAN (interface=pxe10)"; fi

if ((bad)); then
  echo "RESULT: FAIL — menghentikan dnsmasq"
  systemctl stop dnsmasq
  exit 1
fi
echo "RESULT: PASS"
