#!/usr/bin/env bash
# uninstall.sh — copot PXE server + dashboard yang dipasang install.sh (M8, DEC-029 §3).
# Hanya menghapus apa yang tercatat di manifest /var/lib/pxe-dashboard-installer/install-manifest;
# file yang tidak tercatat tidak pernah disentuh. Manifest yang rusak/tidak dikenal -> batal total.
#
# Default: hentikan layanan, hapus konfigurasi (dnsmasq/nginx/NFS/systemd/netplan/env), rilis, Node,
# baris fstab + mount ISO. DATA DIPERTAHANKAN: DB (/var/lib/pxe-dashboard), /srv/pxe/media, ISO.
#   --purge            ikut hapus data yang dibuat installer (DB, /srv/pxe, log dnsmasq) + user pxe
#   --remove-packages  apt-get purge paket yang dipasang installer (yang sudah ada sebelumnya tidak)
#   --dry-run          tampilkan rencana tanpa mengubah apa pun
#   -y, --yes          non-interaktif (tanpa konfirmasi)
# File ISO sumber tidak pernah dihapus, termasuk dengan --purge.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deploy/lib.sh"

PURGE=0; RMPKG=0; YES=0
for a in "$@"; do
  case "$a" in
    --purge) PURGE=1 ;;
    --remove-packages) RMPKG=1 ;;
    --dry-run) DRY=1 ;;
    -y|--yes) YES=1 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf '[pxe-install] ERROR: argumen tidak dikenal: %s (lihat --help)\n' "$a" >&2; exit 2 ;;
  esac
done

is_root || die "harus dijalankan sebagai root (sudo ./uninstall.sh)"
if ! manifest_load; then
  log "manifest $MANIFEST tidak ada — tidak ada yang dipasang install.sh, tidak ada yang dihapus"
  exit 0
fi

has() { local t; for t in "${M_TYPE[@]}"; do [[ "$t" == "$1" ]] && return 0; done; return 1; }
svc_kind() { local i; for i in "${!M_TYPE[@]}"; do [[ "${M_TYPE[$i]}" == svc && "${M_PATH[$i]}" == "$1" ]] && { echo "${M_EXTRA[$i]}"; return 0; }; done; echo none; }
list() { local i; for i in "${!M_TYPE[@]}"; do [[ " $* " == *" ${M_TYPE[$i]} "* ]] && printf '    %-12s %s\n' "${M_TYPE[$i]}" "${M_PATH[$i]}"; done; return 0; }

APT_LOCK=(-o DPkg::Lock::Timeout=600)
req=(); deps=(); MPKGS=" "
for i in "${!M_TYPE[@]}"; do
  [[ "${M_TYPE[$i]}" == pkg ]] || continue
  MPKGS+="${M_PATH[$i]} "
  if [[ "${M_EXTRA[$i]}" == dep ]]; then deps+=("${M_PATH[$i]}"); else req+=("${M_PATH[$i]}"); fi
done
# apt_collateral <pkg...>: simulasi `apt-get -s purge`; cetak paket yang akan ikut dihapus tetapi TIDAK
# tercatat di manifest (CR-8-6). Kosong = aman.
apt_collateral() {
  local out x
  out="$(apt-get "${APT_LOCK[@]}" -s purge "$@" 2>/dev/null)" || { echo "(simulasi apt-get gagal)"; return 0; }
  while read -r x; do [[ -n "$x" && "$MPKGS" != *" $x "* ]] && echo "$x"; done < <(awk '/^(Purg|Remv) / { sub(/:.*/, "", $2); print $2 }' <<<"$out")
  return 0
}
if ((RMPKG && ${#req[@]})); then
  extra="$(apt_collateral "${req[@]}")"
  [[ -z "$extra" ]] || die "--remove-packages akan ikut menghapus paket yang tidak dipasang installer: $(tr '\n' ' ' <<<"$extra")— uninstall dibatalkan tanpa perubahan (jalankan tanpa --remove-packages)"
fi

{
  echo "== Rencana uninstall PXE dashboard$( ((DRY)) && echo " (DRY-RUN: tidak ada yang diubah)") =="
  echo "  Dihentikan + dihapus:"; list unit file link tree fstab mount restore-link dir
  if ((PURGE)); then echo "  Data dihapus (--purge):"; list data user
  else echo "  Data DIPERTAHANKAN (pakai --purge untuk menghapus):"; list data user; fi
  if ((RMPKG)); then echo "  Paket di-purge (--remove-packages):"; list pkg; fi
} >&2
if ((!DRY && !YES)); then
  if [[ -t 0 ]]; then
    read -r -p "Lanjutkan uninstall? [y/N] " ans || true
    [[ "$ans" =~ ^[yY]$ ]] || die "dibatalkan"
  else
    die "mode non-interaktif butuh --yes (atau --dry-run)"
  fi
fi

declare -a KEEP_IDX=()
keep() { KEEP_IDX+=("$1"); }

# 1. Layanan milik installer berhenti dulu; dnsmasq selalu dihentikan (konfigurasi DHCP-nya dicopot).
for i in "${!M_TYPE[@]}"; do
  [[ "${M_TYPE[$i]}" == unit ]] && { run systemctl disable --now "${M_PATH[$i]}" || warn "gagal menghentikan ${M_PATH[$i]}"; }
done
has svc && { run systemctl stop dnsmasq.service || true; }

# 2. Ekspor NFS installer dilepas dan nfs-server dihentikan/di-restart SEBELUM umount: nfsd menahan
#    mount ISO yang pernah dipakai node ("target is busy").
for i in "${!M_TYPE[@]}"; do
  if [[ "${M_TYPE[$i]}" == file && "${M_PATH[$i]}" == "$EXPORTS_FILE" ]] && [[ -f "$(p "$EXPORTS_FILE")" ]] && parent_resolved_ok "$EXPORTS_FILE"; then
    run rm -f "$(p "$EXPORTS_FILE")"
  fi
done
if has mount || has svc; then
  run exportfs -ra || true
  case "$(svc_kind nfs-server.service)" in
    ours|pre-disabled) run systemctl stop nfs-server.service || true ;;
    pre) run systemctl restart nfs-server.service || warn "nfs-server (milik admin) gagal di-restart" ;;
  esac
fi

# 3. Mount ISO + baris fstab (hanya baris persis yang ditambahkan installer). umount gagal = error:
#    entri mount + fstab dipertahankan di manifest agar uninstall ulang mencoba lagi.
UMOUNT_FAILED=()
for i in "${!M_TYPE[@]}"; do
  [[ "${M_TYPE[$i]}" == mount ]] || continue
  if mountpoint -q "$(p "${M_PATH[$i]}")" 2>/dev/null; then
    if ! run umount "${M_PATH[$i]}"; then
      warn "gagal umount ${M_PATH[$i]} (masih dipakai?) — baris fstab dan entri manifest dipertahankan"
      UMOUNT_FAILED+=("${M_PATH[$i]}"); keep "$i"
    fi
  fi
done
fstab_real="$(p "$FSTAB")"
for i in "${!M_TYPE[@]}"; do
  [[ "${M_TYPE[$i]}" == fstab ]] || continue
  if [[ " ${UMOUNT_FAILED[*]} " == *" ${M_PATH[$i]} "* ]]; then keep "$i"; continue; fi
  line="${M_EXTRA[$i]}"
  grep -qxF -- "$line" "$fstab_real" 2>/dev/null || continue
  if ((DRY)); then echo "DRY-RUN: hapus dari $FSTAB: $line"; continue; fi
  tmp="$(mktemp "$(dirname "$fstab_real")/.fstab.pxe.XXXXXX")"
  awk -v l="$line" '$0 != l' "$fstab_real" > "$tmp"
  chmod --reference="$fstab_real" "$tmp"
  mv -f "$tmp" "$fstab_real"
  log "baris fstab dihapus: ${M_PATH[$i]}"
done

# 4. File, symlink, tree aplikasi.
NETPLAN_CHANGED=0
for i in "${!M_TYPE[@]}"; do
  t="${M_TYPE[$i]}"; path="${M_PATH[$i]}"; real="$(p "$path")"
  case "$t" in
    file|link|tree)
      # Induk yang di-resolve harus kanonik (tidak lewat symlink ke tempat lain), SR-8-1.
      if [[ -e "$real" || -L "$real" ]] && ! parent_resolved_ok "$path"; then
        warn "$path: direktori induk lewat symlink — tidak dihapus"; keep "$i"; continue
      fi ;;
  esac
  case "$t" in
    file)
      if [[ -L "$real" || -f "$real" ]]; then
        run rm -f "$real"; [[ "$path" == /etc/netplan/* ]] && NETPLAN_CHANGED=1
      elif [[ -e "$real" ]]; then warn "$path bukan file biasa — dilewati"; fi ;;
    link) [[ -L "$real" ]] && run rm -f "$real" ;;
    tree)
      if [[ -e "$real" || -L "$real" ]]; then
        safe_rm_tree "$path" || { warn "$path di luar root yang boleh dihapus — dilewati"; keep "$i"; continue; }
        run rm -rf --one-file-system "$real"
      fi ;;
  esac
done
for i in "${!M_TYPE[@]}"; do
  [[ "${M_TYPE[$i]}" == restore-link ]] || continue
  if [[ ! -e "$(p "${M_PATH[$i]}")" && ! -L "$(p "${M_PATH[$i]}")" && -e "$(p "${M_EXTRA[$i]}")" ]]; then
    run ln -s "${M_EXTRA[$i]}" "$(p "${M_PATH[$i]}")"
  fi
done

run systemctl daemon-reload
((NETPLAN_CHANGED)) && run netplan apply
# Link VLAN yang dibuat installer: `netplan apply` tidak menghapus link virtual. Dihapus hanya bila masih
# VLAN 802.1Q dengan id + induk yang tercatat dan tidak lagi beralamat; selain itu entri dipertahankan.
for i in "${!M_TYPE[@]}"; do
  [[ "${M_TYPE[$i]}" == vlanlink ]] || continue
  dev="${M_PATH[$i]}"; par="${M_EXTRA[$i]%:*}"; vid="${M_EXTRA[$i]#*:}"
  [[ -e "$(p "/sys/class/net/$dev")" ]] || continue
  l="$(ip -d -o link show dev "$dev" 2>/dev/null || true)"
  if [[ "$l" == *" $dev@$par:"* && "$l" =~ vlan\ protocol\ 802\.1Q\ id\ $vid([^0-9]|$) ]] \
     && [[ -z "$(ip -o addr show dev "$dev" 2>/dev/null | awk '$3 == "inet" || $3 == "inet6"')" ]]; then
    run ip link delete dev "$dev" || { warn "gagal menghapus link $dev"; keep "$i"; }
  else
    warn "link $dev bukan lagi VLAN $vid di $par tanpa alamat — tidak dihapus"; keep "$i"
  fi
done

# 5. Layanan paket: yang dipasang installer dimatikan; yang sudah ada sebelumnya dimuat ulang tanpa
#    konfigurasi installer.
#    `pre-disabled` = sudah ada tetapi disabled sebelum install: enablement asli dipulihkan (CR-8-9).
case "$(svc_kind dnsmasq.service)" in
  ours) run systemctl disable dnsmasq.service || true ;;
  pre) run systemctl restart dnsmasq.service || warn "dnsmasq (sudah ada sebelum install) gagal start ulang" ;;
  pre-disabled) run systemctl disable dnsmasq.service || true ;;
esac
case "$(svc_kind nginx.service)" in
  ours|pre-disabled) run systemctl disable --now nginx.service || true ;;
  pre) run systemctl reload-or-restart nginx.service || warn "nginx gagal dimuat ulang" ;;
esac
case "$(svc_kind nfs-server.service)" in
  ours|pre-disabled) run exportfs -ra || true; run systemctl disable --now nfs-server.service || true ;;
  pre) run exportfs -ra || true ;;
esac

# 6. Direktori kosong buatan installer (terdalam dulu).
mapfile -t dir_idx < <(for i in "${!M_TYPE[@]}"; do [[ "${M_TYPE[$i]}" == dir ]] && printf '%s\t%s\n' "${#M_PATH[$i]}" "$i"; done | sort -rn | cut -f2)
for i in "${dir_idx[@]}"; do
  real="$(p "${M_PATH[$i]}")"
  [[ -d "$real" && ! -L "$real" ]] || continue
  if [[ -z "$(ls -A "$real")" ]]; then run rm -d "$real"
  else warn "${M_PATH[$i]} tidak kosong — dipertahankan"; keep "$i"; fi
done

# 7. Data + user (hanya --purge). Path yang masih memuat mount aktif tidak dihapus.
mounted_under() { awk -v d="$1" '$2 == d || index($2, d "/") == 1 { f = 1 } END { exit !f }' "$(p /proc/mounts)" 2>/dev/null; }
for i in "${!M_TYPE[@]}"; do
  [[ "${M_TYPE[$i]}" == data ]] || continue
  if ((!PURGE)); then keep "$i"; continue; fi
  real="$(p "${M_PATH[$i]}")"
  [[ -e "$real" || -L "$real" ]] || continue
  if mounted_under "${M_PATH[$i]}"; then warn "${M_PATH[$i]} masih memuat mount aktif — tidak dihapus"; keep "$i"; continue; fi
  safe_rm_tree "${M_PATH[$i]}" || { warn "${M_PATH[$i]}: induk lewat symlink / di luar root — tidak dihapus"; keep "$i"; continue; }
  # ISO sumber (kolom 1 entri fstab) tidak pernah ikut terhapus (SR-8-5; validasi sudah menolaknya).
  for j in "${!M_TYPE[@]}"; do
    [[ "${M_TYPE[$j]}" == fstab ]] || continue
    src="${M_EXTRA[$j]%% *}"
    [[ "$src" == "${M_PATH[$i]}" || "$src" == "${M_PATH[$i]}/"* ]] && { warn "${M_PATH[$i]} memuat ISO sumber $src — tidak dihapus"; keep "$i"; continue 2; }
  done
  run rm -rf --one-file-system "$real"
done
for i in "${!M_TYPE[@]}"; do
  [[ "${M_TYPE[$i]}" == user ]] || continue
  if ((PURGE)); then
    if getent passwd "${M_PATH[$i]}" >/dev/null 2>&1; then run userdel "${M_PATH[$i]}" || { warn "userdel ${M_PATH[$i]} gagal"; keep "$i"; }; fi
  else keep "$i"; fi
done

# 8. Paket (hanya --remove-packages, hanya yang dipasang installer). Paket yang diminta installer
#    di-purge; dependensi yang ikut terpasang (`dep`) hanya di-purge bila apt menganggapnya
#    autoremovable setelah itu (tidak dibutuhkan paket lain). Tidak ada `apt-get autoremove` global.
#    Simulasi `apt-get -s purge` sudah memastikan tidak ada paket di luar manifest yang ikut terhapus.
if ((${#req[@]} + ${#deps[@]})); then
  if ((RMPKG)); then
    ((${#req[@]})) && { run env DEBIAN_FRONTEND=noninteractive apt-get "${APT_LOCK[@]}" purge -y "${req[@]}" || warn "apt-get purge gagal"; }
    rm_deps=()
    if ((${#deps[@]})); then
      if ((DRY)); then rm_deps=("${deps[@]}"); echo "DRY-RUN: (dependensi hanya di-purge bila autoremovable)"
      else
        cand="$(apt-get "${APT_LOCK[@]}" -s autoremove 2>/dev/null | awk '/^Remv / { print $2 }' || true)"
        for x in "${deps[@]}"; do grep -qxF -- "$x" <<<"$cand" && rm_deps+=("$x"); done
        if ((${#rm_deps[@]})) && [[ -n "$(apt_collateral "${rm_deps[@]}")" ]]; then
          warn "purge dependensi akan ikut menghapus paket di luar manifest — dependensi dibiarkan"; rm_deps=()
        fi
      fi
      ((${#rm_deps[@]})) && { run env DEBIAN_FRONTEND=noninteractive apt-get "${APT_LOCK[@]}" purge -y "${rm_deps[@]}" || warn "apt-get purge dependensi gagal"; }
    fi
    # Dependensi yang masih dibutuhkan paket lain tetap tercatat (tidak disentuh).
    for i in "${!M_TYPE[@]}"; do
      [[ "${M_TYPE[$i]}" == pkg && "${M_EXTRA[$i]}" == dep && " ${rm_deps[*]} " != *" ${M_PATH[$i]} "* ]] && keep "$i"
    done
  else
    for i in "${!M_TYPE[@]}"; do [[ "${M_TYPE[$i]}" == pkg ]] && keep "$i"; done
  fi
fi

# 9. Manifest: simpan entri yang dipertahankan (agar --purge nanti tetap bisa menghapusnya). Direktori
#    yang sudah ikut terhapus bersama data induknya (--purge) tidak disimpan lagi.
mf="$(p "$MANIFEST")"
kept=()
for i in "${KEEP_IDX[@]}"; do
  if [[ "${M_TYPE[$i]}" =~ ^(dir|data)$ ]] && ((!DRY)) && [[ ! -e "$(p "${M_PATH[$i]}")" ]]; then continue; fi
  kept+=("$i")
done
KEEP_IDX=("${kept[@]}")
if ((${#KEEP_IDX[@]})); then
  if ((DRY)); then echo "DRY-RUN: manifest disisakan ${#KEEP_IDX[@]} entri (data/user/paket yang dipertahankan)"
  else
    tmp="$(mktemp "$mf.XXXXXX")"
    { echo "# manifest install.sh PXE dashboard (sisa setelah uninstall $(date -u +%FT%TZ))"
      for i in "${KEEP_IDX[@]}"; do printf '%s\t%s\t%s\n' "${M_TYPE[$i]}" "${M_PATH[$i]}" "${M_EXTRA[$i]}"; done; } > "$tmp"
    chmod 0600 "$tmp"; mv -f "$tmp" "$mf"
  fi
else
  run rm -f "$mf"
  run rm -d "$(p "$INSTALLER_DIR")"
fi

# 10. Verifikasi: dashboard mati, tidak ada socket dnsmasq/dashboard milik installer.
if ((!DRY)); then
  bad=0
  [[ "$(systemctl is-active pxe-dashboard.service 2>/dev/null || true)" == active ]] && { log "FAIL pxe-dashboard masih aktif"; bad=1; }
  while read -r netid local proc; do
    [[ "$local" == 127.0.0.1:3000 ]] && { log "FAIL masih ada listener $local $proc"; bad=1; }
  done < <(ss_sockets)
  # Hanya dnsmasq.service milik installer yang dinilai (dnsmasq lain, mis. libvirt/LXD, diabaikan; CR-8-1).
  if [[ "$(svc_kind dnsmasq.service)" =~ ^(ours|pre-disabled)$ && "$(systemctl is-active dnsmasq.service 2>/dev/null || true)" == active ]]; then
    log "FAIL dnsmasq.service masih aktif"; bad=1
  fi
  ((bad)) && die "uninstall selesai dengan sisa layanan aktif (lihat FAIL)"
fi
((${#UMOUNT_FAILED[@]})) && die "uninstall belum tuntas: ${UMOUNT_FAILED[*]} masih ter-mount (hentikan yang memakainya lalu jalankan uninstall.sh lagi)"
log "uninstall selesai$( ((DRY)) && echo " (dry-run)")$( ((PURGE)) || echo "; data dipertahankan (DB $STATE_DIR, $MEDIA_DIR) — --purge untuk menghapus")"
