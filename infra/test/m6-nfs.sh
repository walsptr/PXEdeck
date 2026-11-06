# shellcheck shell=bash
# infra/test/m6-nfs.sh — ekspor NFS server test (DEC-009, DEC-020 / BUG-M6-4). Di-source run.sh.
#   - setiap ekspor read-only, hanya klien 10.99.0.0/24, path di bawah /srv/pxe/media, fsid unik;
#   - rocky-9 (stage2 `inst.stage2=nfs:`) dan ubuntu-24.04 (casper netboot=nfs) diekspor;
#   - server-up.sh selalu menyalin ekspor dari repo ke VM sebelum `exportfs -ra` (base di-cache).

test_m6_nfs_exports_ro_pxe_test_only() {
  local f="$INFRA_DIR_UNDER_TEST/server/exports" lines n=0 path rest fsids=""
  lines="$(sed -e 's/#.*$//' -e '/^[[:space:]]*$/d' "$f")"
  while read -r path rest; do
    n=$((n + 1))
    [[ "$path" =~ ^/srv/pxe/media/[a-z0-9][a-z0-9.-]*$ ]] || _fail "path ekspor di luar media: $path"
    # Tepat satu klien: 10.99.0.0/24(opsi), tanpa wildcard/host lain.
    [[ "$rest" =~ ^10\.99\.0\.0/24\(([^\)]*)\)$ ]] || _fail "klien ekspor $path bukan hanya 10.99.0.0/24: $rest"
    local opts=",${BASH_REMATCH[1]},"
    [[ "$opts" == *",ro,"* ]] || _fail "$path tanpa ro"
    [[ "$opts" != *",rw,"* ]] || _fail "$path rw"
    [[ "$opts" == *",no_subtree_check,"* ]] || _fail "$path tanpa no_subtree_check"
    [[ "$opts" =~ ,fsid=([0-9]+), ]] || _fail "$path tanpa fsid"
    [[ " $fsids " != *" ${BASH_REMATCH[1]} "* ]] || _fail "fsid ganda ${BASH_REMATCH[1]}"
    fsids+=" ${BASH_REMATCH[1]}"
  done <<<"$lines"
  ((n >= 2)) || _fail "hanya $n ekspor"
  assert_match "$lines" '^/srv/pxe/media/rocky-9 '
  assert_match "$lines" '^/srv/pxe/media/ubuntu-24\.04 '
  # Path ekspor = PXE_MEDIA_ROOT dashboard (dipakai inst.stage2/nfsroot di boot-script.ts).
  assert_match "$(cat "$INFRA_DIR_UNDER_TEST/server/dashboard.env")" '^PXE_MEDIA_ROOT=/srv/pxe/media$'
  # Media Rocky terpasang di path yang diekspor (fstab CD-ROM read-only).
  assert_match "$(cat "$INFRA_DIR_UNDER_TEST/server/fstab.append")" '^/dev/sr2 /srv/pxe/media/rocky-9 iso9660 ro,'
}

test_m6_nfs_exports_negative_detected() {
  # Kontrol: validator di atas menolak ekspor rw / klien wildcard (salinan sandbox, bukan repo).
  local orig="$INFRA_DIR_UNDER_TEST/server/exports" bad
  for bad in '/srv/pxe/media/rocky-9 10.99.0.0/24(rw,no_subtree_check,fsid=1003)' \
             '/srv/pxe/media/rocky-9 *(ro,no_subtree_check,fsid=1003)' \
             '/srv/pxe/media/rocky-9 10.99.0.0/24(ro,no_subtree_check,fsid=1003) 192.168.1.0/24(ro)' \
             '/etc 10.99.0.0/24(ro,no_subtree_check,fsid=1009)'; do
    mkdir -p "$SB/infra/server"
    { cat "$orig"; echo "$bad"; } > "$SB/infra/server/exports"
    cp "$INFRA_DIR_UNDER_TEST/server/dashboard.env" "$INFRA_DIR_UNDER_TEST/server/fstab.append" "$SB/infra/server/"
    if ( INFRA_DIR_UNDER_TEST="$SB/infra"; _fail() { exit 7; }; test_m6_nfs_exports_ro_pxe_test_only ); then
      _fail "ekspor buruk lolos: $bad"
    fi
  done
}

test_m6_nfs_server_up_pushes_exports() {
  local f="$INFRA_DIR_UNDER_TEST/server-up.sh" l_push l_exportfs
  l_push="$(grep -n "ssh_root 'cat > /etc/exports.d/pxe.exports' < \"\$INFRA_DIR/server/exports\"" "$f" | head -1 | cut -d: -f1)"
  l_exportfs="$(grep -n 'exportfs -ra' "$f" | head -1 | cut -d: -f1)"
  [[ -n "$l_push" ]] || _fail "server-up.sh tidak menyalin exports ke VM"
  [[ -n "$l_exportfs" && "$l_push" -lt "$l_exportfs" ]] || _fail "salin exports (baris $l_push) harus sebelum exportfs -ra (baris $l_exportfs)"
  # server-base.sh tetap menulis berkas yang sama (base baru).
  assert_match "$(cat "$INFRA_DIR_UNDER_TEST/server-base.sh")" 'b64 "\$INFRA_DIR/server/exports"'
}

t "M6 NFS ekspor ro + hanya 10.99.0.0/24, rocky-9 diekspor (DEC-020)"   test_m6_nfs_exports_ro_pxe_test_only
t "M6 NFS validator menolak ekspor rw/wildcard/path lain (kontrol)"     test_m6_nfs_exports_negative_detected
t "M6 server-up menyalin exports sebelum exportfs -ra"                  test_m6_nfs_server_up_pushes_exports
