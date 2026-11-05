#!/bin/bash
# Dijalankan di VM pxe-test-server (sebagai root VM, via ssh_root). Memastikan dnsmasq/nginx/nfsd
# hanya listen di NIC pxe-test (10.99.0.2 / %pxe0). Pelanggaran -> dnsmasq dihentikan, exit 1.
set -uo pipefail
echo "# ss -lntup  ($(date -u +%FT%TZ), $(hostname))"
ss -lntup
echo
echo "# ip -br addr"; ip -br addr
echo
echo "# services"; for s in dnsmasq nginx nfs-server nftables rpcbind; do printf '%-12s %s\n' "$s" "$(systemctl is-active "$s")"; done
echo
echo "# mounts"; findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS | grep /srv/pxe || echo "(tidak ada ISO ter-mount)"
echo
echo "# tftp root"; (cd /srv/pxe/tftp && sha256sum snponly.efi undionly.kpxe 2>&1)
echo
echo "# nft ruleset"; nft list ruleset
echo

bad=0
ok_local() { [[ "$1" == 10.99.0.2:* || "$1" == *%pxe0:* ]]; }
# Kolom ss -lntup: Netid State Recv-Q Send-Q Local Peer [Process]
while read -r netid state rq sq local peer proc; do
  case "$proc" in
    *'"dnsmasq"'*|*'"nginx"'*)
      if ok_local "$local"; then echo "OK   $netid $local $proc"
      else echo "FAIL $netid $local $proc (bukan 10.99.0.2/%pxe0)"; bad=1; fi ;;
  esac
  port="${local##*:}"
  if [[ "$port" == 2049 ]]; then
    if ok_local "$local"; then echo "OK   nfsd $netid $local"
    else echo "FAIL nfsd $netid $local (bukan 10.99.0.2)"; bad=1; fi
  fi
  if [[ "$local" == 192.168.199.* ]]; then
    case "$proc" in *'"sshd"'*) ;; *) echo "FAIL $netid $local $proc (di NIC NAT)"; bad=1 ;; esac
  fi
done < <(ss -lntupH)

# Layanan RPC NFSv3 (rpcbind/mountd/statd) tidak punya opsi bind TCP; wildcard hanya boleh bila
# nftables menolak koneksi baru dari nat0.
if nft list ruleset | grep -q 'iifname "nat0" counter packets [0-9]* bytes [0-9]* drop'; then
  echo "OK   nftables: koneksi baru dari nat0 di-drop (melindungi socket wildcard rpcbind/mountd/statd/sshd)"
else
  echo "FAIL nftables guard nat0 tidak aktif"; bad=1
fi
for s in dnsmasq nginx; do
  [[ "$(systemctl is-active $s)" == active ]] || { echo "FAIL $s tidak aktif"; bad=1; }
done

if ((bad)); then
  echo "RESULT: FAIL — menghentikan dnsmasq"
  systemctl stop dnsmasq
  exit 1
fi
echo "RESULT: PASS"
