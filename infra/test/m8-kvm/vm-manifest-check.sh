#!/usr/bin/env bash
# infra/test/m8-kvm/vm-manifest-check.sh — DIJALANKAN DI VM (root) lewat
# `ssh root@10.99.0.2 'MODE=keep|purge MF=/root/m8-manifest.copy bash -s' < vm-manifest-check.sh`.
# Memeriksa setiap entri salinan manifest (diambil sebelum uninstall) setelah uninstall.sh:
#   file/link/tree/dir -> harus hilang (dir: boleh tetap bila tidak kosong & dicatat ulang)
#   unit -> tidak aktif & tidak enabled; svc ours -> tidak aktif/enabled
#   fstab -> baris persis tidak ada lagi di /etc/fstab; mount -> bukan mountpoint
#   data -> MODE=keep: harus ADA; MODE=purge: harus HILANG; user -> keep: ada, purge: hilang
#   restore-link -> symlink default nginx dipulihkan
# Keluaran baris OK/FAIL; exit = jumlah FAIL.
set -uo pipefail
fails=0
ok() { printf 'OK   %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; fails=$((fails + 1)); }
[[ -f "$MF" ]] || { echo "FAIL salinan manifest $MF tidak ada"; exit 99; }
while IFS=$'\t' read -r t p x; do
  [[ -z "$t" || "$t" == \#* ]] && continue
  case "$t" in
    file|link|tree)
      if [[ -e "$p" || -L "$p" ]]; then bad "$t $p masih ada"; else ok "$t $p hilang"; fi ;;
    dir)
      if [[ ! -e "$p" ]]; then ok "dir $p hilang"
      elif [[ -n "$(ls -A "$p" 2>/dev/null)" ]] && grep -qP "^dir\t$p\t" /var/lib/pxe-dashboard-installer/install-manifest 2>/dev/null; then ok "dir $p tidak kosong, dipertahankan + tetap di manifest"
      elif [[ "$MODE" == keep ]] && [[ "$p" == /srv/pxe/* ]]; then ok "dir $p dipertahankan (di bawah data /srv/pxe)"
      else bad "dir $p masih ada"; fi ;;
    unit)
      a="$(systemctl is-active "$p" 2>/dev/null)"; e="$(systemctl is-enabled "$p" 2>/dev/null)"
      if [[ "$a" != active && "$e" != enabled ]]; then ok "unit $p active=$a enabled=${e:-none}"; else bad "unit $p active=$a enabled=$e"; fi ;;
    svc)
      a="$(systemctl is-active "$p" 2>/dev/null)"; e="$(systemctl is-enabled "$p" 2>/dev/null)"
      if [[ "$x" == ours ]]; then
        if [[ "$a" != active && "$e" != enabled ]]; then ok "svc(ours) $p active=$a enabled=$e"; else bad "svc(ours) $p active=$a enabled=$e"; fi
      else ok "svc(pre) $p active=$a enabled=$e (tidak dinilai)"; fi ;;
    fstab)
      if grep -qxF -- "$x" /etc/fstab; then bad "fstab $p baris masih ada"; else ok "fstab $p baris hilang"; fi ;;
    mount)
      if mountpoint -q "$p" 2>/dev/null; then bad "mount $p masih ter-mount"; else ok "mount $p tidak ter-mount"; fi ;;
    data)
      if [[ "$MODE" == keep ]]; then
        if [[ -e "$p" ]]; then ok "data $p dipertahankan"; else bad "data $p hilang (harus dipertahankan)"; fi
      else
        if [[ -e "$p" ]]; then bad "data $p masih ada setelah --purge"; else ok "data $p dihapus (--purge)"; fi
      fi ;;
    user)
      if [[ "$MODE" == keep ]]; then
        if getent passwd "$p" >/dev/null; then ok "user $p dipertahankan"; else bad "user $p hilang"; fi
      else
        if getent passwd "$p" >/dev/null; then bad "user $p masih ada setelah --purge"; else ok "user $p dihapus (--purge)"; fi
      fi ;;
    restore-link)
      if [[ -L "$p" && "$(readlink "$p")" == "$x" ]]; then ok "restore-link $p -> $x dipulihkan"
      elif [[ ! -e "$x" ]] && ! dpkg-query -W -f='${db:Status-Abbrev}' nginx-common 2>/dev/null | grep -q '^ii'; then
        ok "restore-link $p: nginx-common sudah di-purge (--remove-packages) sehingga site default ikut hilang"
      else bad "restore-link $p tidak dipulihkan"; fi ;;
    pkg)
      s="$(dpkg-query -W -f='${Status}' "$p" 2>/dev/null)"
      ok "pkg $p status='$s' (tanpa --remove-packages: tetap)" ;;
    *) bad "tipe tidak dikenal $t $p" ;;
  esac
done < "$MF"
echo "# manifest-check MODE=$MODE fails=$fails"
exit "$fails"
