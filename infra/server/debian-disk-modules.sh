#!/usr/bin/env bash
# infra/server/debian-disk-modules.sh — BUG-M6-8. Dijalankan di HOST (read-only terhadap ISO).
# initrd netboot Debian tidak memuat driver disk (virtio_blk, virtio_scsi); d-i mengambilnya sebagai
# udeb (*-modules-<kver>-di) dari mirror, tetapi pool DVD-1 TIDAK memuat udeb itu (sudah tertanam di
# initrd CD `install.amd/initrd.gz`). Script ini menyalin modul tersebut dari initrd DVD — kernel
# ABI-nya harus sama dengan initrd netboot — ke <outdir>/<kver>/<modul>.ko, untuk disajikan nginx di
# http://<server>/media/debian-netboot/modules/<kver>/ dan dimuat `insmod` oleh preseed/early_command.
# Pakai: debian-disk-modules.sh <dvd-iso> <netboot-initrd.gz> <outdir>   → stdout: <kver>
# Exit: 0 ok · 2 argumen · 3 kver DVD ≠ kver netboot · 4 modul tidak ada di initrd DVD.
set -euo pipefail

MODULES=(drivers/block/virtio_blk.ko drivers/scsi/virtio_scsi.ko)

(($# == 3)) || { echo "pakai: $0 <dvd-iso> <netboot-initrd.gz> <outdir>" >&2; exit 2; }
iso="$1" netboot="$2" out="$3"
[[ -f "$iso" && -f "$netboot" ]] || { echo "ISO/initrd netboot tidak ada" >&2; exit 2; }

kver_of() { # kver_of <daftar file initrd> → versi kernel (satu-satunya lib/modules/<v>/)
  sed -n 's#^\(\./\)\{0,1\}lib/modules/\([^/]*\)/.*#\2#p' | sort -u
}
dvd_list="$(bsdtar -xOf "$iso" install.amd/initrd.gz | zcat | bsdtar -tf -)"
net_kver="$(zcat "$netboot" | bsdtar -tf - | kver_of)"
dvd_kver="$(kver_of <<<"$dvd_list")"
[[ -n "$dvd_kver" && "$dvd_kver" == "$net_kver" ]] || {
  echo "kver initrd DVD ($dvd_kver) ≠ netboot ($net_kver): modul tidak bisa dimuat" >&2
  exit 3
}
paths=()
for m in "${MODULES[@]}"; do
  # Nama entri apa adanya di arsip (dengan atau tanpa prefiks "./").
  p="$(grep -xE "(\./)?lib/modules/$dvd_kver/kernel/$m" <<<"$dvd_list" | head -n 1 || true)"
  [[ -n "$p" ]] || { echo "modul $m tidak ada di initrd DVD" >&2; exit 4; }
  paths+=("$p")
done
tmp="$(mktemp -d "$out.tmp.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
bsdtar -xOf "$iso" install.amd/initrd.gz | zcat | bsdtar -xf - -C "$tmp" "${paths[@]}"
mkdir -p "$out/$dvd_kver"
for p in "${paths[@]}"; do install -m 0644 "$tmp/$p" "$out/$dvd_kver/$(basename "$p")"; done
echo "$dvd_kver"
