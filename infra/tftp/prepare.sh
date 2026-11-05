#!/usr/bin/env bash
# infra/tftp/prepare.sh — salin snponly.efi + undionly.kpxe (paket ipxe resmi Ubuntu noble,
# lihat .agent/runs/media.log) dari .agent/media/ipxe/ ke infra/tftp/ dan verifikasi sha256
# terhadap infra/tftp/SHA256SUMS. Biner tidak di-commit (.gitignore); server-up.sh menyalinnya
# ke /srv/pxe/tftp di VM pxe-test-server.
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
dst="$INFRA_DIR/tftp"
for f in snponly.efi undionly.kpxe; do
  [[ -f "$MEDIA_DIR/ipxe/$f" ]] || die "$MEDIA_DIR/ipxe/$f tidak ada (jalankan unduh media dulu)"
  cp -f "$MEDIA_DIR/ipxe/$f" "$dst/$f"
done
(cd "$dst" && sha256sum -c SHA256SUMS)
