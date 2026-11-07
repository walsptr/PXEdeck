#!/usr/bin/env bash
# infra/test/m8-kvm/vm-snapshot.sh — DIJALANKAN DI VM pxe-test-install (root) lewat
# `ssh root@10.99.0.2 'bash -s' < vm-snapshot.sh`. Snapshot /etc (M8 KVM, DEC-029 §4, uji
# "uninstall tidak menyentuh file di luar manifest"). Keluaran TSV ke stdout:
#   <path>\t<type f|l|d>\t<mode>\t<uid:gid>\t<sha256 | target symlink | ->\t<paket dpkg pemilik | ->
# Isi file TIDAK pernah dicetak (hanya sha256), jadi /etc/shadow & env dashboard aman.
set -euo pipefail
declare -A owner=()
# Peta path -> paket dari daftar file dpkg (cepat, tanpa dpkg -S per file).
while IFS=: read -r pkg path; do
  [[ "$path" == /etc/* ]] && owner["$path"]="${pkg%%:*}"
done < <(for f in /var/lib/dpkg/info/*.list; do b="$(basename "$f" .list)"; sed "s|^|$b:|" "$f"; done 2>/dev/null)
while IFS= read -r -d '' p; do
  t="$(stat -c '%F' "$p")"
  case "$t" in
    "regular file"|"regular empty file") ty=f; h="$(sha256sum "$p" | cut -d' ' -f1)" ;;
    "symbolic link") ty=l; h="$(readlink "$p")" ;;
    directory) ty=d; h=- ;;
    *) ty=o; h=- ;;
  esac
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$p" "$ty" "$(stat -c '%a' "$p")" "$(stat -c '%u:%g' "$p")" "$h" "${owner[$p]:--}"
done < <(find /etc -xdev -print0 | sort -z)
