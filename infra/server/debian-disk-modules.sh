#!/usr/bin/env bash
# infra/server/debian-disk-modules.sh — BUG-M6-8. Dijalankan di HOST (read-only terhadap ISO).
# initrd netboot Debian tidak memuat driver disk (virtio_blk, virtio_scsi); d-i mengambilnya sebagai
# udeb (*-modules-<kver>-di) dari mirror, tetapi pool DVD-1 TIDAK memuat udeb itu (sudah tertanam di
# initrd CD `install.amd/initrd.gz`). Script ini menyalin modul tersebut dari initrd DVD — kernel
# ABI-nya harus sama dengan initrd netboot — ke <outdir>/<kver>/<modul>.ko, untuk disajikan nginx di
# http://<server>/media/debian-netboot/modules/<kver>/ dan dimuat `insmod` oleh preseed/early_command.
# Pakai: debian-disk-modules.sh <dvd-iso> <netboot-initrd.gz> <outdir>   → stdout: <kver>
#   <dvd-iso> boleh file ISO, perangkat blok (/dev/srN, dibaca bsdtar), atau direktori ISO yang sudah
#   ter-mount (berisi install.amd/initrd.gz) — M8: install.sh memakai mountpoint /srv/pxe/media/debian-12.
# Exit: 0 ok · 2 argumen · 3 kver DVD ≠ kver netboot · 4 modul tidak ada di initrd DVD.
set -euo pipefail

MODULES=(drivers/block/virtio_blk.ko drivers/scsi/virtio_scsi.ko)

(($# == 3)) || { echo "pakai: $0 <dvd-iso> <netboot-initrd.gz> <outdir>" >&2; exit 2; }
iso="$1" netboot="$2" out="$3"
[[ ( -f "$iso" || -b "$iso" || -f "$iso/install.amd/initrd.gz" ) && -f "$netboot" ]] || { echo "ISO/initrd netboot tidak ada" >&2; exit 2; }
# dvd_initrd: initrd.gz DVD ke stdout dari ISO/perangkat (bsdtar) atau direktori ter-mount.
dvd_initrd() {
  if [[ -d "$iso" ]]; then cat "$iso/install.amd/initrd.gz"; else bsdtar -xOf "$iso" install.amd/initrd.gz; fi
}

kver_of() { # kver_of <daftar file initrd> → versi kernel (satu-satunya lib/modules/<v>/)
  sed -n 's#^\(\./\)\{0,1\}lib/modules/\([^/]*\)/.*#\2#p' | sort -u
}
dvd_list="$(dvd_initrd | zcat | bsdtar -tf -)"
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
dvd_initrd | zcat | bsdtar -xf - -C "$tmp" "${paths[@]}"
mkdir -p "$out/$dvd_kver"
for p in "${paths[@]}"; do install -m 0644 "$tmp/$p" "$out/$dvd_kver/$(basename "$p")"; done
echo "$dvd_kver"
