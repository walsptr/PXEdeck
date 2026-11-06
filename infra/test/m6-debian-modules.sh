# shellcheck shell=bash
# infra/test/m6-debian-modules.sh — BUG-M6-8: driver disk virtio untuk d-i netboot disalin dari initrd
# DVD (kver sama) dan disajikan server. Di-source run.sh. ISO/initrd PALSU dibuat bsdtar di sandbox.

_m6dm_initrd() { # _m6dm_initrd <out.gz> <kver> <rel-path...> → initrd gzip cpio newc berisi file palsu
  local out="$1" kver="$2" root; shift 2
  root="$(mktemp -d "$SB/initrd.XXXXXX")"
  local p
  for p in "$@"; do mkdir -p "$root/lib/modules/$kver/$(dirname "$p")"; printf 'ko %s\n' "$p" > "$root/lib/modules/$kver/$p"; done
  mkdir -p "$root/bin"; : > "$root/bin/sh"
  (cd "$root" && bsdtar --format newc -cf - .) | gzip -c > "$out"
}
_m6dm_iso() { # _m6dm_iso <out.iso> <initrd.gz>
  local root; root="$(mktemp -d "$SB/iso.XXXXXX")"
  mkdir -p "$root/install.amd"; cp "$2" "$root/install.amd/initrd.gz"
  bsdtar --format iso9660 -cf "$1" -C "$root" .
}
M6DM_MODS=(kernel/drivers/block/virtio_blk.ko kernel/drivers/scsi/virtio_scsi.ko)

test_m6_debian_modules_extract_ok() {
  local h="$INFRA_DIR_UNDER_TEST/server/debian-disk-modules.sh"
  _m6dm_initrd "$SB/dvd-initrd.gz" 6.1.0-50-amd64 "${M6DM_MODS[@]}" kernel/drivers/ata/ahci.ko
  _m6dm_iso "$SB/dvd.iso" "$SB/dvd-initrd.gz"
  _m6dm_initrd "$SB/netboot.gz" 6.1.0-50-amd64 kernel/drivers/net/virtio_net.ko
  local out rc
  rc=0; out="$("$h" "$SB/dvd.iso" "$SB/netboot.gz" "$SB/mods" 2>&1)" || rc=$?
  assert_eq "$rc" 0 "$out"
  assert_eq "$out" "6.1.0-50-amd64"
  assert_eq "$(cat "$SB/mods/6.1.0-50-amd64/virtio_blk.ko")" "ko kernel/drivers/block/virtio_blk.ko"
  assert_eq "$(cat "$SB/mods/6.1.0-50-amd64/virtio_scsi.ko")" "ko kernel/drivers/scsi/virtio_scsi.ko"
  assert_eq "$(ls "$SB/mods/6.1.0-50-amd64" | tr '\n' ' ')" "virtio_blk.ko virtio_scsi.ko "
  assert_no_file "$SB/mods/6.1.0-50-amd64/ahci.ko"
  # Tidak ada sisa direktori sementara.
  assert_eq "$(ls "$SB" | grep -c '^mods\.tmp\.')" 0
}

test_m6_debian_modules_extract_fail() {
  local h="$INFRA_DIR_UNDER_TEST/server/debian-disk-modules.sh" rc
  _m6dm_initrd "$SB/dvd-initrd.gz" 6.1.0-50-amd64 "${M6DM_MODS[@]}"
  _m6dm_iso "$SB/dvd.iso" "$SB/dvd-initrd.gz"
  # kver netboot berbeda → 3 (modul tidak akan bisa dimuat), tanpa keluaran berkas.
  _m6dm_initrd "$SB/netboot-49.gz" 6.1.0-49-amd64 kernel/drivers/net/virtio_net.ko
  rc=0; "$h" "$SB/dvd.iso" "$SB/netboot-49.gz" "$SB/m1" >/dev/null 2>&1 || rc=$?
  assert_eq "$rc" 3; assert_no_file "$SB/m1"
  # Modul tidak ada di initrd DVD → 4.
  _m6dm_initrd "$SB/dvd2-initrd.gz" 6.1.0-50-amd64 kernel/drivers/block/virtio_blk.ko
  _m6dm_iso "$SB/dvd2.iso" "$SB/dvd2-initrd.gz"
  _m6dm_initrd "$SB/netboot.gz" 6.1.0-50-amd64 kernel/drivers/net/virtio_net.ko
  rc=0; "$h" "$SB/dvd2.iso" "$SB/netboot.gz" "$SB/m2" >/dev/null 2>&1 || rc=$?
  assert_eq "$rc" 4; assert_no_file "$SB/m2"
  # Argumen salah → 2.
  rc=0; "$h" "$SB/dvd.iso" >/dev/null 2>&1 || rc=$?; assert_eq "$rc" 2
  rc=0; "$h" "$SB/tidak-ada.iso" "$SB/netboot.gz" "$SB/m3" >/dev/null 2>&1 || rc=$?; assert_eq "$rc" 2
}

test_m6_debian_modules_server_up_wiring() {
  local f="$INFRA_DIR_UNDER_TEST/server-up.sh" s
  s="$(cat "$f")"
  assert_contains "$s" 'mod_dir="$VMS_DIR/pxe-test-debian-disk-modules"'
  assert_contains "$s" 'run "$INFRA_DIR/server/debian-disk-modules.sh" "$ISO_DEBIAN" "$MEDIA_DIR/debian-netboot/initrd.gz" "$mod_dir"'
  assert_contains "$s" ':/srv/pxe/media/debian-netboot/modules/"'
  # assert_path_in_vms sebelum rm -rf pada direktori modul.
  local la lr
  la="$(grep -n 'assert_path_in_vms "$mod_dir"' "$f" | cut -d: -f1)"; lr="$(grep -n 'run rm -rf "$mod_dir"' "$f" | cut -d: -f1)"
  [[ -n "$la" && -n "$lr" && "$la" -lt "$lr" ]] || _fail "assert_path_in_vms harus sebelum rm -rf ($la/$lr)"
  # Dry-run: helper hanya dicetak (ISO palsu kosong tidak dibaca).
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1
  local m="$PXE_AGENT_DIR/media"; mkdir -p "$m/debian-netboot"; : > "$m/debian-netboot/linux"; : > "$m/debian-netboot/initrd.gz"
  run_infra server-up.sh
  assert_eq "$RC" 0 "$(tail -5 <<<"$OUT")"
  assert_match "$(unq "$OUT")" "^DRY-RUN: .*/server/debian-disk-modules\.sh .*/debian-12\.15\.0-amd64-DVD-1\.iso .*/debian-netboot/initrd\.gz .*/pxe-test-debian-disk-modules$"
}

t "M6 BUG-M6-8 modul disk Debian: salin dari initrd DVD (kver sama)"      test_m6_debian_modules_extract_ok
t "M6 BUG-M6-8 modul disk Debian: kver beda/modul hilang/argumen → gagal" test_m6_debian_modules_extract_fail
t "M6 BUG-M6-8 server-up menyalin modul disk Debian ke media server"      test_m6_debian_modules_server_up_wiring
