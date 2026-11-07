#!/usr/bin/env bash
# infra/test/m8-kvm/vm-refuse-setup.sh — DIJALANKAN DI VM pxe-test-install (root) lewat
# `ssh root@10.99.0.2 'CASE=dnsmasq|nfs|clean bash -s' < vm-refuse-setup.sh` (M8 iterasi 2, DEC-030
# CR-8-3/CR-8-4). Mensimulasikan ADMIN yang sudah memasang dnsmasq / nfs-kernel-server dengan
# konfigurasi aktif lain SEBELUM installer:
#   dnsmasq  apt install dnsmasq + /etc/dnsmasq.d/admin-lab.conf (port=5353, listen 127.0.0.1)
#   nfs      apt install nfs-kernel-server + baris ekspor admin di /etc/exports (/srv/admin-share)
#   clean    purge paket admin itu lagi + hapus konfigurasi admin (tanpa autoremove global:
#            hanya dependensi yang menjadi autoremovable karena purge ini)
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
A=(-o DPkg::Lock::Timeout=600)
case "${CASE:-}" in
  dnsmasq)
    apt-get "${A[@]}" update -qq
    apt-get "${A[@]}" install -y -qq --no-install-recommends dnsmasq >/dev/null
    printf '# konfigurasi admin (bukan installer)\nport=5353\nlisten-address=127.0.0.1\nbind-interfaces\n' > /etc/dnsmasq.d/admin-lab.conf
    systemctl restart dnsmasq.service || true
    echo "dnsmasq: $(dpkg-query -W -f='${Status}' dnsmasq) active=$(systemctl is-active dnsmasq) enabled=$(systemctl is-enabled dnsmasq)"
    ;;
  nfs)
    apt-get "${A[@]}" update -qq
    apt-get "${A[@]}" install -y -qq --no-install-recommends nfs-kernel-server >/dev/null
    mkdir -p /srv/admin-share
    printf '/srv/admin-share 127.0.0.1(ro,no_subtree_check)\n' >> /etc/exports
    exportfs -ra || true
    echo "nfs-kernel-server: $(dpkg-query -W -f='${Status}' nfs-kernel-server) active=$(systemctl is-active nfs-server) enabled=$(systemctl is-enabled nfs-server)"
    exportfs -v
    ;;
  clean)
    rm -f /etc/dnsmasq.d/admin-lab.conf
    before="$(apt-get -s autoremove 2>/dev/null | awk '/^Remv /{print $2}' | sort)"
    pk=(); for p in dnsmasq nfs-kernel-server; do dpkg-query -W -f='${db:Status-Abbrev}' "$p" 2>/dev/null | grep -q '^ii' && pk+=("$p"); done
    ((${#pk[@]})) && apt-get "${A[@]}" purge -y -qq "${pk[@]}" >/dev/null
    after="$(apt-get -s autoremove 2>/dev/null | awk '/^Remv /{print $2}' | sort)"
    new="$(comm -13 <(echo "$before") <(echo "$after") | tr '\n' ' ')"
    [[ -n "${new// }" ]] && apt-get "${A[@]}" purge -y -qq $new >/dev/null
    rm -rf /srv/admin-share
    echo "dipurge: ${pk[*]} ${new}"
    ;;
  *) echo "CASE?" >&2; exit 2 ;;
esac
