#!/usr/bin/env bash
# infra/test/m8-kvm/vm-ss-shim.sh — DIJALANKAN DI VM pxe-test-install (root) lewat
# `ssh root@10.99.0.2 'bash -s' < vm-ss-shim.sh`. SHIM DIAGNOSTIK, BUKAN PERBAIKAN PRODUK.
# Temuan M8 (install.sh:690-701): verify() membaca `ss -lunpH` / `ss -ltnpH` dengan 7 field
# (netid state rq sq local peer proc), padahal ss dengan SATU protokol tidak mencetak kolom Netid
# (6 kolom) -> proc selalu kosong -> "dnsmasq tidak listen DHCP" -> install selalu gagal.
# Agar sisa skenario DEC-029 §4 (node, idempotensi, uninstall) tetap bisa diuji, run.sh (M8_SS_SHIM=1)
# menjalankan install.sh dengan PATH=/root/m8-shim:$PATH: `ss -lunpH` -> baris udp dari `ss -lntupH`,
# `ss -ltnpH` -> baris tcp dari `ss -lntupH` (format 7 kolom yang diasumsikan install.sh). Argumen
# lain diteruskan apa adanya ke /usr/bin/ss.
set -euo pipefail
mkdir -p /root/m8-shim
cat > /root/m8-shim/ss <<'SH'
#!/bin/sh
case "$*" in
  -lunpH) exec /usr/bin/ss -lntupH | grep '^udp' ;;
  -ltnpH) exec /usr/bin/ss -lntupH | grep '^tcp' ;;
  *) exec /usr/bin/ss "$@" ;;
esac
SH
chmod 0755 /root/m8-shim/ss
echo "# shim /root/m8-shim/ss:"; cat /root/m8-shim/ss
