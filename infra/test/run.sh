#!/usr/bin/env bash
# infra/test/run.sh — test shell infra KVM (M4-T12, AC-4.28) dengan virsh/virt-install/qemu-img/
# ssh PALSU di PATH (infra/test/fake-bin) + INFRA_DRY_RUN. Tidak pernah menyentuh libvirt asli.
# Pakai: infra/test/run.sh   (exit 0 = semua lulus)
set -euo pipefail
source "$(dirname "$0")/harness.sh"

PROTECTED=(pxe-test-node01 ubuntu24.04 default int)

# Baris DRY-RUN dicetak dengan `printf %q` (koma/spasi/kutip di-escape `\`) → hapus backslash
# sebelum dicocokkan.
unq() { sed 's/\\//g' <<<"$1"; }
MUTATE_VERBS='net-define|net-start|net-destroy|net-undefine|start|destroy|shutdown|undefine|reset'

# Nama resource pada setiap perintah mutasi (DRY-RUN atau palsu) — semua wajib ^pxe-test-.
names_in_mutations() {
  { grep -E '^DRY-RUN: virsh' <<<"$1" || true; grep -E '^virsh ' "$FAKE_LOG" || true; } |
    sed -E 's/^DRY-RUN: //' |
    awk -v verbs="^($MUTATE_VERBS)$" '{ for (i = 1; i <= NF; i++) if ($i ~ verbs) { j = i + 1; if ($j == "--nvram") j++; if ($i == "net-define") print "XML:" $j; else print $j } }'
  { grep -E '^DRY-RUN: virt-install' <<<"$1" || true; grep -E '^virt-install ' "$FAKE_LOG" || true; } |
    grep -oE -- '--name [^ ]+' | awk '{print $2}'
}

# ---------------------------------------------------------------------------------------------
test_bash_n_all() {
  local f n=0
  while IFS= read -r f; do
    bash -n "$f" || _fail "bash -n $f"
    n=$((n + 1))
  done < <(find "$INFRA_DIR_UNDER_TEST" -name '*.sh' -not -path '*/test/*' | sort)
  ((n >= 15)) || _fail "hanya $n script ditemukan"
  for f in "$INFRA_TEST_DIR"/*.sh "$INFRA_TEST_DIR"/fake-bin/*; do bash -n "$f" || _fail "bash -n $f"; done
}

test_set_euo_pipefail() {
  local f
  for f in "$INFRA_DIR_UNDER_TEST"/*.sh; do
    [[ "$(basename "$f")" == lib.sh ]] && continue
    # verify-node.sh berjalan DI NODE dan sengaja tanpa -e agar semua cek dilaporkan (exit = #FAIL).
    if [[ "$(basename "$f")" == verify-node.sh ]]; then grep -q '^set -uo pipefail' "$f" || _fail "$f"; continue; fi
    grep -q '^set -euo pipefail' "$f" || _fail "$f tanpa set -euo pipefail"
  done
}

test_fake_path_isolated() {
  local c
  for c in virsh virt-install qemu-img ssh scp socat curl; do
    assert_eq "$(command -v "$c")" "$INFRA_TEST_DIR/fake-bin/$c" "$c harus palsu"
  done
  ! command -v sudo >/dev/null || _fail "sudo tersedia di PATH test"
  ! command -v ss >/dev/null || _fail "ss tersedia di PATH test"
}

test_net_xml() {
  local x n
  x="$(grep -v '^\s*<!--' "$INFRA_DIR_UNDER_TEST/net/pxe-test.xml" | sed '/<!--/,/-->/d')"
  assert_contains "$x" "<name>pxe-test</name>"
  assert_contains "$x" "<bridge name='virbr-pxe'"
  assert_contains "$x" "<dns enable='no'/>"
  assert_contains "$x" "<ip address='10.99.0.1' netmask='255.255.255.0'/>"
  assert_not_contains "$x" "<forward" "pxe-test terisolasi"
  assert_not_contains "$x" "<dhcp" "pxe-test tanpa dhcp"
  n="$(grep -v '^\s*<!--' "$INFRA_DIR_UNDER_TEST/net/pxe-test-nat.xml" | sed '/<!--/,/-->/d')"
  assert_contains "$n" "<name>pxe-test-nat</name>"
  assert_contains "$n" "<forward mode='nat'/>"
  assert_contains "$n" "<bridge name='virbr-pxenat'"
  assert_not_contains "$n" "<dhcp" "pxe-test-nat tanpa dhcp"
  assert_contains "$n" "<dns enable='no'/>"
}

test_net_up_dry_run() {
  export INFRA_DRY_RUN=1
  run_infra net-up.sh
  assert_eq "$RC" 0 "net-up dry-run"
  assert_match "$OUT" "^DRY-RUN: virsh -c qemu:///system net-define .*/net/pxe-test\.xml$"
  assert_match "$OUT" "^DRY-RUN: virsh -c qemu:///system net-start pxe-test$"
  assert_match "$OUT" "^DRY-RUN: virsh -c qemu:///system net-define .*/net/pxe-test-nat\.xml$"
  assert_match "$OUT" "^DRY-RUN: virsh -c qemu:///system net-start pxe-test-nat$"
  assert_empty "$(mutating_calls)" "dry-run tidak boleh mengeksekusi mutasi"
  # Dua kali → output identik (tanpa efek samping).
  local first="$OUT"; run_infra net-up.sh
  assert_eq "$RC" 0; assert_eq "$(grep DRY-RUN <<<"$OUT")" "$(grep DRY-RUN <<<"$first")"
  assert_empty "$(mutating_calls)"
}

test_net_up_idempotent_fake() {
  # Tanpa dry-run, virsh PALSU memodelkan state: run 1 define+start, run 2 tanpa mutasi.
  run_infra net-up.sh
  assert_eq "$RC" 0 "net-up #1: $OUT"
  assert_eq "$(cat "$FAKE_STATE/net/pxe-test")" yes
  assert_eq "$(cat "$FAKE_STATE/net/pxe-test-nat")" yes
  assert_eq "$(grep -cE ' net-(define|start) ' "$FAKE_LOG")" 4
  : > "$FAKE_LOG"
  run_infra net-up.sh
  assert_eq "$RC" 0 "net-up #2"
  assert_empty "$(mutating_calls)" "net-up kedua harus idempoten"
  assert_contains "$OUT" "network pxe-test sudah terdefinisi"
  assert_contains "$OUT" "network pxe-test-nat sudah aktif"
  # Network terdefinisi tapi mati → hanya net-start.
  echo no > "$FAKE_STATE/net/pxe-test"; : > "$FAKE_LOG"
  run_infra net-up.sh
  assert_eq "$(mutating_calls)" "virsh -c qemu:///system net-start pxe-test"
  # Network milik user (default/int) tidak pernah disentuh.
  assert_no_match "$(cat "$FAKE_LOG")" " (default|int)( |$)"
}

test_assert_name_and_path() {
  # shellcheck source=/dev/null
  source "$INFRA_DIR_UNDER_TEST/lib.sh"
  local n
  for n in "${PROTECTED[@]}" vm-lain pxe-test-UPPER "pxe-test-a b" pxe-test-../x "" pxe-testx; do
    ( assert_name "$n" ) 2>/dev/null && _fail "assert_name menerima '$n'"
  done
  for n in pxe-test pxe-test-m4-node11 pxe-test-server pxe-test-nat; do ( assert_name "$n" ) || _fail "assert_name menolak '$n'"; done
  ( assert_path_in_vms "$VMS_DIR/pxe-test-m4-node11.qcow2" ) || _fail "path di vms ditolak"
  for p in /tmp/pxe-test-x.qcow2 "$VMS_DIR/../pxe-test-x.qcow2" "$VMS_DIR/sub/pxe-test-x.qcow2" "$VMS_DIR/node.qcow2" /dev/sda; do
    ( assert_path_in_vms "$p" ) 2>/dev/null && _fail "assert_path_in_vms menerima '$p'"
  done
  # Symlink direktori di dalam vms yang menunjuk ke luar → ditolak (pwd -P).
  mkdir -p "$SB/luar"; ln -s "$SB/luar" "$VMS_DIR/link"
  ( assert_path_in_vms "$VMS_DIR/link/pxe-test-x.qcow2" ) 2>/dev/null && _fail "symlink keluar vms diterima"
  ( assert_mac 52:54:00:99:00:11 ) || _fail "MAC valid ditolak"
  for m in 52:54:00:10:10:11 aa:bb:cc:dd:ee:ff 52:54:00:99:00; do ( assert_mac "$m" ) 2>/dev/null && _fail "MAC $m diterima"; done
  [[ "${#PROTECTED_NAMES[@]}" -eq 4 ]] || _fail "PROTECTED_NAMES berubah"
}

test_node_rejects_protected() {
  # node.sh (node-create) menolak nama terlindungi/non-prefix: exit ≠ 0 TANPA perintah virsh apa pun.
  local n a
  echo running > "$FAKE_STATE/dom/pxe-test-node01"; echo "shut off" > "$FAKE_STATE/dom/ubuntu24.04"
  for a in create destroy reset; do
    for n in "${PROTECTED[@]}" vm-lain pxe-test-server pxe-test-server-base "../pxe-test-x"; do
      : > "$FAKE_LOG"
      run_infra node.sh "$a" "$n" 52:54:00:99:00:11 uefi
      assert_ne "$RC" 0 "node.sh $a $n"
      assert_eq "$(cat "$FAKE_LOG")" "" "node.sh $a $n memanggil perintah"
    done
  done
  for a in "" "1"; do
    INFRA_DRY_RUN="$a" run_infra node.sh create pxe-test-m4-node11 52:54:00:10:10:11 uefi
    assert_ne "$RC" 0 "MAC di luar 52:54:00:99"
    assert_empty "$(mutating_calls)"
  done
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-node01")" running
  assert_eq "$(cat "$FAKE_STATE/dom/ubuntu24.04")" "shut off"
}

test_disk_ops_guarded_by_assert_path() {
  # Path disk tidak bisa dipilih bebas lewat argumen (diturunkan dari VMS_DIR + nama tervalidasi);
  # setiap rm/qemu-img pada disk VM didahului assert_path_in_vms (diuji langsung di
  # test_assert_name_and_path). Bukti statis: urutan baris di setiap script.
  local f line_assert line_op
  for f in node.sh server-up.sh server-down.sh cleanup.sh server-base.sh; do
    line_assert="$(grep -n 'assert_path_in_vms' "$INFRA_DIR_UNDER_TEST/$f" | head -1 | cut -d: -f1)"
    line_op="$(grep -nE 'run (rm -f|qemu-img)' "$INFRA_DIR_UNDER_TEST/$f" | grep -vE 'SEED|seed|READY|ready|base\.ready' | head -1 | cut -d: -f1)"
    [[ -n "$line_assert" ]] || _fail "$f tanpa assert_path_in_vms"
    [[ -z "$line_op" || "$line_assert" -le "$line_op" ]] || _fail "$f: operasi disk (baris $line_op) sebelum assert_path_in_vms (baris $line_assert)"
  done
  # Dinamis: VMS_DIR tidak ada → node.sh create gagal sebelum qemu-img/virt-install.
  rm -rf "$PXE_AGENT_DIR/vms"; ln -s "$SB/tidak-ada" "$PXE_AGENT_DIR/vms"
  echo yes > "$FAKE_STATE/net/pxe-test"
  run_infra node.sh create pxe-test-m4-node11 52:54:00:99:00:11 uefi
  assert_ne "$RC" 0 "VMS_DIR rusak"
  assert_empty "$(mutating_calls)"
}

test_node_create_dry_run() {
  export INFRA_DRY_RUN=1
  run_infra node.sh create pxe-test-m4-node11 52:54:00:99:00:11 uefi
  assert_eq "$RC" 0 "$OUT"
  local vms="$PXE_AGENT_DIR/vms"
  assert_match "$OUT" "^DRY-RUN: qemu-img create -q -f qcow2 $vms/pxe-test-m4-node11\.qcow2 20G$"
  local vi; vi="$(unq "$(grep '^DRY-RUN: virt-install' <<<"$OUT")")"
  assert_contains "$vi" "--name pxe-test-m4-node11 --memory 2048 --vcpus 2"
  assert_contains "$vi" "--network network=pxe-test,mac=52:54:00:99:00:11,model=virtio"
  assert_contains "$vi" "--pxe --boot network,hd,loader=/usr/share/edk2/ovmf/OVMF_CODE.fd"
  assert_contains "$vi" "loader_secure=no"
  assert_contains "$vi" "--disk path=$vms/pxe-test-m4-node11.qcow2,format=qcow2"
  assert_contains "$vi" "--connect qemu:///system"
  assert_empty "$(mutating_calls)"
  run_infra node.sh create pxe-test-m4-node12 52:54:00:99:00:12 bios
  vi="$(unq "$(grep '^DRY-RUN: virt-install' <<<"$OUT")")"
  assert_contains "$vi" "--pxe --boot network,hd,bios.useserial=on"
  assert_not_contains "$vi" "OVMF"
  run_infra node.sh create pxe-test-m4-node13 52:54:00:99:00:13 arm
  assert_ne "$RC" 0 "firmware tak dikenal"
}

test_node_lifecycle_fake() {
  echo yes > "$FAKE_STATE/net/pxe-test"
  run_infra node.sh create pxe-test-m4-node11 52:54:00:99:00:11 uefi
  # serial_capture_start non-dry butuh socat (palsu) + ss (tidak ada → loop tunggu habis, tetap lanjut).
  assert_eq "$RC" 0 "$OUT"
  assert_file "$PXE_AGENT_DIR/vms/pxe-test-m4-node11.qcow2"
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-m4-node11")" running
  : > "$FAKE_LOG"
  run_infra node.sh reset pxe-test-m4-node11
  assert_eq "$RC" 0; assert_eq "$(mutating_calls)" "virsh -c qemu:///system reset pxe-test-m4-node11"
  : > "$FAKE_LOG"
  run_infra node.sh destroy pxe-test-m4-node11 52:54:00:99:00:11
  assert_eq "$RC" 0 "$OUT"
  assert_match "$(cat "$FAKE_LOG")" "virsh -c qemu:///system destroy pxe-test-m4-node11"
  assert_match "$(cat "$FAKE_LOG")" "virsh -c qemu:///system undefine --nvram pxe-test-m4-node11"
  assert_no_file "$FAKE_STATE/dom/pxe-test-m4-node11"
  assert_no_file "$PXE_AGENT_DIR/vms/pxe-test-m4-node11.qcow2"
  # Destroy kedua: idempoten (tidak ada mutasi).
  : > "$FAKE_LOG"; run_infra node.sh destroy pxe-test-m4-node11 52:54:00:99:00:11
  assert_eq "$RC" 0; assert_empty "$(mutating_calls)"
}

_seed_mixed_domains() {
  local d
  for d in pxe-test-node01 ubuntu24.04 pxe-test-m5-node11 pxe-test-server; do echo running > "$FAKE_STATE/dom/$d"; done
  echo running > "$FAKE_STATE/dom/pxe-test-m4-node11"; touch "$FAKE_STATE/dom/pxe-test-m4-node11.nvram"
  echo "shut off" > "$FAKE_STATE/dom/pxe-test-m4-node12"
  for n in pxe-test pxe-test-nat default int; do echo yes > "$FAKE_STATE/net/$n"; done
  for f in pxe-test-m4-node11 pxe-test-m4-node12 pxe-test-m4-orphan pxe-test-m5-node11 pxe-test-node01 pxe-test-server pxe-test-server-base; do
    : > "$PXE_AGENT_DIR/vms/$f.qcow2"
  done
}

test_cleanup_only_run_resources() {
  _seed_mixed_domains
  run_infra cleanup.sh m4
  assert_eq "$RC" 0 "$OUT"
  local log; log="$(cat "$FAKE_LOG")"
  assert_match "$log" "virsh -c qemu:///system destroy pxe-test-m4-node11"
  assert_match "$log" "virsh -c qemu:///system undefine --nvram pxe-test-m4-node11"
  assert_match "$log" "virsh -c qemu:///system undefine pxe-test-m4-node12"
  local n
  for n in pxe-test-node01 ubuntu24.04 pxe-test-m5-node11 pxe-test-server default int pxe-test pxe-test-nat; do
    assert_no_match "$(mutating_calls)" " $n$" "cleanup menyentuh $n"
  done
  for n in pxe-test-node01 ubuntu24.04 pxe-test-m5-node11 pxe-test-server; do assert_eq "$(cat "$FAKE_STATE/dom/$n")" running "$n"; done
  assert_no_file "$PXE_AGENT_DIR/vms/pxe-test-m4-node11.qcow2"
  assert_no_file "$PXE_AGENT_DIR/vms/pxe-test-m4-orphan.qcow2"
  for f in pxe-test-m5-node11 pxe-test-node01 pxe-test-server pxe-test-server-base; do assert_file "$PXE_AGENT_DIR/vms/$f.qcow2"; done
  # Bukti snapshot sebelum/sesudah.
  local rep="$PXE_RUNS_DIR/cleanup.txt"
  assert_file "$rep"
  assert_eq "$(grep -c '^## before' "$rep")" 1; assert_eq "$(grep -c '^## after' "$rep")" 1
}

test_cleanup_server_flag() {
  _seed_mixed_domains
  run_infra cleanup.sh m4 --server
  assert_eq "$RC" 0 "$OUT"
  assert_match "$(cat "$FAKE_LOG")" "virsh -c qemu:///system (shutdown|destroy) pxe-test-server"
  assert_match "$(cat "$FAKE_LOG")" "virsh -c qemu:///system undefine pxe-test-server$"
  assert_no_file "$PXE_AGENT_DIR/vms/pxe-test-server.qcow2"
  assert_file "$PXE_AGENT_DIR/vms/pxe-test-server-base.qcow2"
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-node01")" running
  assert_eq "$(cat "$FAKE_STATE/dom/ubuntu24.04")" running
}

test_cleanup_dry_run() {
  _seed_mixed_domains
  export INFRA_DRY_RUN=1
  run_infra cleanup.sh m4 --server
  assert_eq "$RC" 0 "$OUT"
  assert_empty "$(mutating_calls)" "dry-run cleanup"
  assert_match "$OUT" "^DRY-RUN: virsh -c qemu:///system destroy pxe-test-m4-node11$"
  assert_match "$OUT" "^DRY-RUN: rm -f .*/vms/pxe-test-m4-orphan\.qcow2$"
  assert_no_match "$OUT" "DRY-RUN: .*(pxe-test-node01|ubuntu24\.04|pxe-test-m5)"
  assert_file "$PXE_AGENT_DIR/vms/pxe-test-m4-orphan.qcow2"
}

test_cleanup_rejects_protected_names() {
  # AC-4.28: cleanup.sh menolak (exit ≠ 0, tanpa perintah virsh) nama terlindungi.
  _seed_mixed_domains
  local n bad=0
  for n in "${PROTECTED[@]}" "../x" "m4 node"; do
    : > "$FAKE_LOG"
    run_infra cleanup.sh "$n"
    assert_empty "$(mutating_calls)" "cleanup.sh '$n' melakukan mutasi" || bad=1
    assert_ne "$RC" 0 "cleanup.sh '$n' harus ditolak (exit ≠ 0)" || bad=1
    assert_empty "$(grep '^virsh' "$FAKE_LOG" || true)" "cleanup.sh '$n' memanggil virsh" || bad=1
  done
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-node01")" running || bad=1
  assert_eq "$(cat "$FAKE_STATE/dom/ubuntu24.04")" running || bad=1
  ((bad == 0))
}

test_cleanup_unknown_option() {
  run_infra cleanup.sh m4 --semua
  assert_ne "$RC" 0
  assert_empty "$(cat "$FAKE_LOG")"
}

test_server_down_dry_and_fake() {
  echo running > "$FAKE_STATE/dom/pxe-test-server"; echo running > "$FAKE_STATE/dom/pxe-test-node01"
  : > "$PXE_AGENT_DIR/vms/pxe-test-server.qcow2"
  INFRA_DRY_RUN=1 run_infra server-down.sh --purge
  assert_eq "$RC" 0; assert_empty "$(mutating_calls)"
  assert_match "$OUT" "^DRY-RUN: virsh -c qemu:///system shutdown pxe-test-server$"
  run_infra server-down.sh --purge
  assert_eq "$RC" 0 "$OUT"
  assert_no_file "$FAKE_STATE/dom/pxe-test-server"
  assert_no_file "$PXE_AGENT_DIR/vms/pxe-test-server.qcow2"
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-node01")" running
}

test_net_down_only_pxe_test() {
  for n in pxe-test pxe-test-nat default int; do echo yes > "$FAKE_STATE/net/$n"; done
  run_infra net-down.sh
  assert_eq "$RC" 0 "$OUT"
  assert_no_file "$FAKE_STATE/net/pxe-test"; assert_no_file "$FAKE_STATE/net/pxe-test-nat"
  assert_eq "$(cat "$FAKE_STATE/net/default")" yes; assert_eq "$(cat "$FAKE_STATE/net/int")" yes
  assert_no_match "$(mutating_calls)" " (default|int)$"
}

_prepare_kvm_run_sandbox() {
  # server-base: base sudah siap (marker) → tidak provisioning. server-up: ISO + file TFTP ada.
  local m="$PXE_AGENT_DIR/media" v="$PXE_AGENT_DIR/vms"
  : > "$v/pxe-test-server-base.qcow2"; echo test > "$v/pxe-test-server-base.ready"
  for iso in ubuntu-24.04.5-live-server-amd64.iso debian-12.15.0-amd64-DVD-1.iso Rocky-9-latest-x86_64-minimal.iso; do : > "$m/$iso"; done
  cp "$INFRA_DIR_UNDER_TEST/tftp/snponly.efi" "$INFRA_DIR_UNDER_TEST/tftp/undionly.kpxe" "$m/ipxe/"
  echo running > "$FAKE_STATE/dom/pxe-test-node01"; echo "shut off" > "$FAKE_STATE/dom/ubuntu24.04"
  for n in default int; do echo yes > "$FAKE_STATE/net/$n"; done
}

test_kvm_run_dry_run_end_to_end() {
  [[ -f "$INFRA_DIR_UNDER_TEST/tftp/snponly.efi" ]] || _fail "infra/tftp/snponly.efi tidak ada (prasyarat)"
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1
  run_infra kvm-run.sh m4
  assert_eq "$RC" 0 "kvm-run dry-run: $(tail -20 <<<"$OUT")"
  OUT="$(unq "$OUT")"
  assert_empty "$(mutating_calls)" "kvm-run dry-run mengeksekusi mutasi"
  # Rencana memuat semua tahap.
  # (Output net-up dialihkan kvm-run ke stderr dan tidak dicocokkan di sini; rencana net-up
  # diuji di test_net_up_dry_run.)
  assert_match "$OUT" "DRY-RUN: virt-install .*--name pxe-test-server .*--network network=pxe-test,mac=52:54:00:99:01:02"
  assert_match "$OUT" "DRY-RUN: env PXE_STANDALONE=1 npm --prefix .*/dashboard run build"
  assert_match "$OUT" "DRY-RUN: virt-install .*--name pxe-test-m4-node11 .*mac=52:54:00:99:00:11.*OVMF_CODE"
  assert_match "$OUT" "DRY-RUN: virt-install .*--name pxe-test-m4-node12 .*mac=52:54:00:99:00:12.*bios\.useserial"
  assert_match "$OUT" "DRY-RUN: env PXE_KVM_BASE_URL=http://10\.99\.0\.2 .*PXE_KVM_NODES=.*pxe-test-m4-node11=52:54:00:99:00:11=uefi=10\.99\.0\.21.* npx --prefix .*playwright test -c .*/e2e-kvm/playwright\.config\.ts"
  assert_match "$OUT" "DRY-RUN: ssh .* m4admin@10\.99\.0\.21 "
  assert_match "$OUT" "DRY-RUN: ssh .* m4admin@10\.99\.0\.22 "
  # Semua nama resource yang dimutasi berprefix pxe-test-; tidak ada nama terlindungi.
  local names n
  names="$(names_in_mutations "$OUT")"
  [[ -n "$names" ]] || _fail "tidak ada nama terdeteksi"
  while IFS= read -r n; do
    [[ "$n" == XML:* ]] && { n="$(basename "${n#XML:}" .xml)"; }
    [[ "$n" =~ ^pxe-test(-[a-z0-9-]+)?$ ]] || _fail "nama '$n' tidak berprefix pxe-test-"
    for p in "${PROTECTED[@]}"; do [[ "$n" != "$p" ]] || _fail "nama terlindungi $p dimutasi"; done
  done <<<"$names"
  # ssh/scp hanya ke 10.99.0.*.
  assert_no_match "$(grep -E '^DRY-RUN: (ssh|scp) ' <<<"$OUT" | grep -oE '[a-z0-9]+@[0-9.]+' | grep -vE '@10\.99\.0\.[0-9]+$' || true)" "."
  # Cleanup selalu jalan (trap EXIT) + ringkasan langkah.
  assert_match "$OUT" "cleanup .*done"
  assert_match "$(cat "$PXE_RUNS_DIR/kvm-run.txt")" "result +PASS"
  # Network/VM milik user tidak berubah.
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-node01")" running
  assert_eq "$(cat "$FAKE_STATE/dom/ubuntu24.04")" "shut off"
  # Key node sekali pakai tidak tertinggal.
  assert_eq "$(ls "$PXE_AGENT_DIR/keys" | grep -c 'pxe-test-m4-.*node_ed25519' || true)" 0
}

test_kvm_run_rejects_bad_args() {
  local a
  for a in "m4 --nodes 01:uefi" "m4 --nodes 11:arm" "m4 --nodes 11:uefi_12:bios" "m4 --nodes x" "default" "pxe-test-node01" "m4 --nodes '11:uefi 12:bios 13:uefi 14:bios'"; do
    : > "$FAKE_LOG"
    set +e; OUT="$(eval "bash '$INFRA_DIR_UNDER_TEST/kvm-run.sh' $a" </dev/null 2>&1)"; RC=$?; set -e
    assert_ne "$RC" 0 "kvm-run $a"
    assert_empty "$(mutating_calls)" "kvm-run $a"
  done
  # Node duplikat.
  set +e; OUT="$(bash "$INFRA_DIR_UNDER_TEST/kvm-run.sh" m4 --nodes "11:uefi 11:bios" </dev/null 2>&1)"; RC=$?; set -e
  assert_ne "$RC" 0; assert_contains "$OUT" "ganda"
}

test_kvm_run_existing_node_aborts_without_touching() {
  # Sisa run sebelumnya: kvm-run menolak (preflight) dan tidak menyentuh server/node.
  _prepare_kvm_run_sandbox
  echo running > "$FAKE_STATE/dom/pxe-test-m4-node11"
  export INFRA_DRY_RUN=1
  run_infra kvm-run.sh m4 --nodes 11:uefi
  assert_ne "$RC" 0
  assert_contains "$OUT" "sudah ada"
  assert_no_match "$OUT" "DRY-RUN: virt-install"
  assert_no_match "$OUT" "DRY-RUN: virsh .* (shutdown|destroy|undefine) pxe-test-server"
}

test_deploy_dry_run_no_secrets() {
  export INFRA_DRY_RUN=1
  run_infra deploy-dashboard.sh
  assert_eq "$RC" 0 "$OUT"
  OUT="$(unq "$OUT")"
  assert_empty "$(mutating_calls)"
  assert_match "$OUT" "DRY-RUN: ssh .* pxe@10\.99\.0\.2 mkdir -m 700 '/tmp/pxe-test-deploy\."
  assert_match "$OUT" "DRY-RUN: ssh .* root@10\.99\.0\.2 RELEASE_TS=.* bash -s"
  # dashboard.env: tanpa secret, DB di /var/lib/pxe-dashboard, trust proxy, seed empty.
  local env; env="$(cat "$INFRA_DIR_UNDER_TEST/server/dashboard.env")"
  assert_match "$env" "^PXE_DB_PATH=/var/lib/pxe-dashboard/"
  assert_match "$env" "^PXE_TRUST_PROXY=1$"
  assert_match "$env" "^PXE_MGMT_CIDR=10\.99\.0\.0/24$"
  assert_no_match "$env" "^PXE_SEED=demo"
  ! grep -Eiq 'password|secret|\$6\$|PRIVATE KEY' "$INFRA_DIR_UNDER_TEST/server/dashboard.env" || _fail "dashboard.env memuat secret"
  # Stage sementara (TMPDIR sandbox) dibersihkan trap.
  assert_eq "$(ls -A "$TMPDIR")" ""
}

test_dnsmasq_conf_bound() {
  local c; c="$(grep -vE '^\s*(#|$)' "$INFRA_DIR_UNDER_TEST/server/dnsmasq.conf")"
  assert_match "$c" "^interface=pxe0$"
  assert_match "$c" "^bind-interfaces$"
  assert_match "$c" "^dhcp-range=pxe0,10\.99\.0\.100,10\.99\.0\.200,"
  assert_match "$c" "^dhcp-boot=tag:ipxe,http://10\.99\.0\.2/boot/"
  assert_no_match "$c" "^interface=(nat0|lo|enp|eth|wl)"
  assert_no_match "$c" "192\.168\.199"
  local v; v="$(cat "$INFRA_DIR_UNDER_TEST/server/verify-listen.sh")"
  # ss -lntup ⊇ ss -lunp (listen, UDP, numerik, proses) — CLAUDE.md §Pengujian KVM.
  assert_match "$v" "ss -l[a-z]*u[a-z]*p"
  assert_match "$v" "ss -l[a-z]*n[a-z]*"
}

test_no_sudo_and_ssh_targets() {
  local f hits
  # verify-node.sh dieksekusi di VM node (sudo -n di dalam VM uji = bagian verifikasi AC-4.31).
  hits="$(grep -nE '(^|[;&|[:space:]])sudo[[:space:]]' "$INFRA_DIR_UNDER_TEST"/*.sh "$INFRA_DIR_UNDER_TEST"/tftp/*.sh | grep -v '/verify-node.sh:' | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true)"
  assert_empty "$hits" "sudo di script host"
  # Semua ssh/scp di script host lewat SSH_OPTS (key .agent/keys) ke 10.99.0.* / $SERVER_IP / node IP.
  hits="$(grep -nE '\b(ssh|scp) ' "$INFRA_DIR_UNDER_TEST"/*.sh | grep -vE 'SSH_OPTS|ssh-keygen|^\S+:\s*#|ssh_(server|root)|log |echo |die |"\$NODE_USER@\$ip"|PreferredAuthentications|pw_out=' || true)"
  # pw_out= (kvm-run.sh): uji login PASSWORD harus ditolak — sengaja tanpa key, target $NODE_USER@$ip.
  grep -A2 'pw_out="$(ssh' "$INFRA_DIR_UNDER_TEST/kvm-run.sh" | grep -q 'PubkeyAuthentication=no' || _fail "cek password tanpa PubkeyAuthentication=no"
  grep -A3 'pw_out="$(ssh' "$INFRA_DIR_UNDER_TEST/kvm-run.sh" | grep -q '"$NODE_USER@$ip"' || _fail "cek password bukan ke IP node"
  assert_empty "$hits" "ssh tanpa opsi key"
  for f in "$INFRA_DIR_UNDER_TEST"/*.sh; do
    assert_no_match "$(cat "$f")" "\.ssh/id_|~/\.ssh" "$f membaca ~/.ssh"
  done
}

test_verify_node_script() {
  # infra/verify-node.sh → dashboard/e2e-kvm/verify-node.sh (lokasi yang dicari kvm-run.sh).
  assert_eq "$(readlink "$INFRA_DIR_UNDER_TEST/verify-node.sh")" "../dashboard/e2e-kvm/verify-node.sh"
  assert_file "$REPO_UNDER_TEST/dashboard/e2e-kvm/verify-node.sh"
  # Env kosong → gagal cepat (exit 99) tanpa menjalankan cek.
  set +e; OUT="$(env -i PATH="$PATH" bash "$INFRA_DIR_UNDER_TEST/verify-node.sh" </dev/null 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 99 "$OUT"
  assert_contains "$OUT" "FAIL env EXPECT_HOSTNAME kosong"
  # Cek yang dituntut AC-4.31 ada di script.
  local v; v="$(cat "$INFRA_DIR_UNDER_TEST/verify-node.sh")"
  for needle in 'hostname' 'ip -4 -o addr' 'ip -4 route show default' 'resolvectl dns' 'sudo -n true' 'authorized_keys' 'sshd -T' 'passwordauthentication' '/etc/pxe-callback'; do
    assert_contains "$v" "$needle"
  done
  # Tidak ada variabel password/token yang dibaca dari env (hanya komentar yang menyebutnya).
  assert_no_match "$(grep -v "^\s*#" <<<"$v")" "PASSWORD|TOKEN|\\$\\{?(PASS|TOKEN)"
}

# Data uji secret dibangun saat runtime (tidak ada token/hash/header key literal di repo).
_fake_token() { local s=""; while ((${#s} < 43)); do s+="Ab9_-xYz"; done; printf '%s' "${s:0:43}"; }
_fake_hash() { printf '$6$%s$%s' "saltSALT1234" "$(printf 'h%.0s' {1..86})"; }
_fake_pkey_header() { printf -- '-----BEGIN %s PRIVATE KEY-----' "OPENSSH"; }

test_redact_evidence_masks_secrets() {
  local d="$SB/evidence" tok hash
  tok="$(_fake_token)"; hash="$(_fake_hash)"
  mkdir -p "$d/sub"
  {
    echo "GET /boot/52:54:00:99:00:11/$tok/user-data HTTP/1.1 200"
    echo "GET /boot/52-54-00-99-00-12/$tok/meta-data 200"
    echo "GET /boot/52%3A54%3A00%3A99%3A00%3A13/$tok 200"
    echo "GET /boot/525400990014/$tok?x=1 200"
    echo "GET /boot/52:54:00:99:00:11.ipxe?platform=efi 200"
  } > "$d/nginx-access.log"
  {
    echo "curl http://10.99.0.2/api/callback?token=$tok&status=done"
    echo "{\"token\":\"$tok\",\"status\":\"installing\"}"
    echo "TOKEN = '$tok'"
  } > "$d/sub/journal.txt"
  printf 'password: %s\nuser m4admin\n' "$hash" > "$d/sub/console.log"
  run_infra redact-evidence.sh "$d"
  assert_eq "$RC" 0 "$OUT"
  assert_contains "$OUT" "bersih"
  local all; all="$(cat "$d/nginx-access.log" "$d/sub/journal.txt" "$d/sub/console.log")"
  assert_not_contains "$all" "$tok" "token tersisa"
  assert_not_contains "$all" "$hash" "hash tersisa"
  assert_no_match "$all" '\$6\$saltSALT'
  # Bentuk redaksi + konteks dipertahankan.
  assert_contains "$all" "/boot/52:54:00:99:00:11/REDACTED-TOKEN/user-data"
  assert_contains "$all" "/boot/52-54-00-99-00-12/REDACTED-TOKEN/meta-data"
  assert_contains "$all" "/boot/52%3A54%3A00%3A99%3A00%3A13/REDACTED-TOKEN 200"
  assert_contains "$all" "/boot/525400990014/REDACTED-TOKEN?x=1"
  assert_contains "$all" "token=REDACTED-TOKEN&status=done"
  assert_contains "$all" "\"token\":\"REDACTED-TOKEN\""
  assert_contains "$all" "TOKEN = 'REDACTED-TOKEN'"
  assert_contains "$all" 'password: $6$REDACTED'
  # Baris non-secret tidak berubah.
  assert_contains "$all" "GET /boot/52:54:00:99:00:11.ipxe?platform=efi 200"
  assert_contains "$all" "user m4admin"
  # Idempoten: dijalankan ulang tetap bersih dan isi identik.
  local before; before="$(cat "$d/nginx-access.log" "$d/sub/journal.txt" "$d/sub/console.log")"
  run_infra redact-evidence.sh "$d"
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(cat "$d/nginx-access.log" "$d/sub/journal.txt" "$d/sub/console.log")" "$before" "redaksi ulang mengubah isi"
}

# B-5: blob base64 (late-command dicetak installer ke console) berisi token/hash disamarkan.
_b64() { printf '%s' "$1" | base64 -w0; }
_utf16le_b64() { local i s="$1"; for ((i = 0; i < ${#s}; i++)); do printf '%s\0' "${s:i:1}"; done | base64 -w0; }
test_redact_evidence_masks_base64_secrets() {
  local d="$SB/evidence" tok hash url u1 u2 u3 u4 u5 benign all before
  tok="$(_fake_token)"; hash="$(_fake_hash)"
  url="http://10.99.0.2/boot/52:54:00:99:00:11/$tok/status"
  u1="$(_b64 "$url"$'\n')"
  u2="$(_b64 "#!/bin/sh"$'\n'"printf %s '$u1' | base64 -d > /etc/pxe-callback/url && chmod 600 /etc/pxe-callback/url"$'\n')"
  u3="$(_b64 "user:$hash:20000:0:99999:7:::")"
  u4="$(_utf16le_b64 "try { Invoke-WebRequest -Method Post -Body 'stage=done' -Uri '$url' } catch {}")"
  u5="$(_b64 "$(_fake_pkey_header)"$'\n'"AAAA"$'\n')"
  benign="$(_b64 "# Dipasang PXE dashboard: login hanya dengan key"$'\n'"PasswordAuthentication no"$'\n')"
  mkdir -p "$d/sub"
  {
    printf "start:  subiquity/Late/run/command_5: printf %%s '%s' | base64 -d > /target/etc/pxe-callback/url\r\n" "$u1"
    printf "d-i preseed/late_command string in-target sh -c 'echo %s | base64 -d > /tmp/pxe-late.sh'\n" "$u2"
    printf 'blob=%s\n' "$u3"
    printf 'x%s y\n' "$u1"
    printf '\x1b[0m%s\x1b[0m\n' "$u3"
    printf 'start: command_3: printf %%s %s | base64 -d > /target/etc/ssh/sshd_config.d/60.conf\n' "$benign"
  } > "$d/console.log"
  printf 'powershell -EncodedCommand %s\nkey %s\n' "$u4" "$u5" > "$d/sub/unattend.txt"
  run_infra redact-evidence.sh "$d"
  assert_eq "$RC" 0 "$OUT"
  all="$(cat "$d/console.log" "$d/sub/unattend.txt")"
  for b in "$u1" "$u2" "$u3" "$u4" "$u5"; do assert_not_contains "$all" "$b" "blob ber-secret tersisa"; done
  assert_contains "$all" "printf %s 'REDACTED-B64-SECRET' | base64 -d > /target/etc/pxe-callback/url"
  assert_contains "$all" "sh -c 'echo REDACTED-B64-SECRET | base64 -d"
  assert_contains "$all" "blob=REDACTED-B64-SECRET"
  assert_match "$all" "^REDACTED-B64-SECRET y$" "blob tak sejajar (prefix alnum) tetap terdeteksi"
  assert_contains "$all" "-EncodedCommand REDACTED-B64-SECRET"
  assert_contains "$all" "key REDACTED-B64-SECRET"
  # Blob tanpa secret dibiarkan apa adanya.
  assert_contains "$all" "printf %s $benign | base64 -d"
  # Idempoten.
  before="$all"
  run_infra redact-evidence.sh "$d"
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(cat "$d/console.log" "$d/sub/unattend.txt")" "$before" "redaksi ulang mengubah isi"
}

test_redact_evidence_private_key_fails() {
  local d="$SB/evidence"
  mkdir -p "$d"
  { echo "log biasa"; _fake_pkey_header; echo; echo "b3BlbnNzaC1rZXktdjEAAAAA"; } > "$d/leak.txt"
  echo "baris aman" > "$d/ok.txt"
  run_infra redact-evidence.sh "$d"
  assert_ne "$RC" 0 "header private key harus menggagalkan redaksi"
  assert_eq "$RC" 1 "$OUT"
  assert_contains "$OUT" "TEMUAN"
  assert_match "$OUT" "leak\.txt:2"
  assert_not_contains "$OUT" "ok.txt" "file bersih ikut dilaporkan"
  # Isi tidak dibocorkan ke output (hanya file:baris).
  assert_not_contains "$OUT" "b3BlbnNzaC1rZXktdjEAAAAA"
}

test_redact_evidence_bad_args() {
  run_infra redact-evidence.sh
  assert_eq "$RC" 2 "tanpa argumen: $OUT"
  assert_contains "$OUT" "pakai:"
  run_infra redact-evidence.sh "$SB/tidak-ada"
  assert_eq "$RC" 2 "direktori tak ada: $OUT"
  mkdir -p "$SB/a" "$SB/b"
  run_infra redact-evidence.sh "$SB/a" "$SB/b"
  assert_eq "$RC" 2 "dua argumen: $OUT"
}

test_kvm_run_calls_redact_in_finish() {
  local k; k="$(sed -n '/^finish()/,/^}/p' "$INFRA_DIR_UNDER_TEST/kvm-run.sh")"
  assert_contains "$k" 'redact-evidence.sh" "$RUNS_DIR"'
  assert_contains "$k" "step redact FAIL"
}

# ---------------------------------------------------------------------------------------------
_build_safe_bin
echo "infra/test/run.sh — $(date -u +%FT%TZ)"
t "bash -n semua script infra"                                   test_bash_n_all
t "set -euo pipefail di setiap script"                            test_set_euo_pipefail
t "PATH test hanya berisi virsh/ssh palsu, tanpa sudo"            test_fake_path_isolated
t "XML pxe-test tanpa forward/dhcp, dns off; pxe-test-nat NAT"    test_net_xml
t "net-up dry-run: rencana define/start, tanpa mutasi"            test_net_up_dry_run
# B-3: node harus didefinisikan TANPA tahap install virt-install (XML live on_reboot=restart),
# tetap PXE-first (network sebelum hd) untuk UEFI dan BIOS.
test_node_create_no_install_phase() {
  export INFRA_DRY_RUN=1
  local fw vi
  for fw in uefi bios; do
    run_infra node.sh create pxe-test-m4-node11 52:54:00:99:00:11 "$fw"
    assert_eq "$RC" 0 "$OUT"
    vi="$(unq "$(grep '^DRY-RUN: virt-install' <<<"$OUT")")"
    assert_match "$vi" "(--import|--install no_install=yes)" "$fw: virt-install memicu tahap install"
    assert_match "$vi" "--boot network,hd" "$fw: PXE-first"
    assert_not_contains "$vi" "--wait" "$fw"
  done
}

test_node_reset_keeps_running_fake() {
  echo yes > "$FAKE_STATE/net/pxe-test"
  run_infra node.sh create pxe-test-m4-node11 52:54:00:99:00:11 uefi
  assert_eq "$RC" 0 "$OUT"
  assert_match "$(cat "$FAKE_LOG")" "virsh -c qemu:///system dumpxml pxe-test-m4-node11" "pemeriksaan pasca-create"
  assert_eq "$(cat "$FAKE_STATE/onreboot/pxe-test-m4-node11")" restart
  run_infra node.sh reset pxe-test-m4-node11
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-m4-node11")" running "VM mati setelah reset"
}

test_node_create_fails_on_live_onreboot_destroy() {
  # virt-install (palsu) memaksa XML live on_reboot=destroy → node.sh create exit≠0 dan
  # membersihkan domain + disk miliknya.
  echo yes > "$FAKE_STATE/net/pxe-test"
  FAKE_VIRT_INSTALL_ONREBOOT=destroy run_infra node.sh create pxe-test-m4-node11 52:54:00:99:00:11 uefi
  assert_ne "$RC" 0 "create harus gagal bila on_reboot live bukan restart"
  assert_contains "$OUT" "on_reboot"
  assert_no_file "$FAKE_STATE/dom/pxe-test-m4-node11"
  assert_no_file "$PXE_AGENT_DIR/vms/pxe-test-m4-node11.qcow2"
}

t "net-up dua kali idempoten (virsh palsu ber-state)"             test_net_up_idempotent_fake
t "assert_name / assert_path_in_vms / assert_mac"                 test_assert_name_and_path
t "node.sh menolak nama terlindungi tanpa perintah virsh"         test_node_rejects_protected
t "operasi disk VM selalu didahului assert_path_in_vms"         test_disk_ops_guarded_by_assert_path
t "node.sh create dry-run UEFI/BIOS sesuai spesifikasi"           test_node_create_dry_run
t "node.sh create/reset/destroy (palsu) idempoten"                test_node_lifecycle_fake
t "node.sh create tanpa tahap install virt-install (B-3)"         test_node_create_no_install_phase
t "node.sh reset: VM tetap running (on_reboot=restart, B-3)"      test_node_reset_keeps_running_fake
t "node.sh create gagal bila XML live on_reboot=destroy (B-3)"    test_node_create_fails_on_live_onreboot_destroy
t "cleanup.sh hanya resource run + snapshot"                      test_cleanup_only_run_resources
t "cleanup.sh --server"                                           test_cleanup_server_flag
t "cleanup.sh dry-run tanpa mutasi"                               test_cleanup_dry_run
t "cleanup.sh menolak nama terlindungi (exit≠0, tanpa virsh)"     test_cleanup_rejects_protected_names
t "cleanup.sh opsi tak dikenal"                                   test_cleanup_unknown_option
t "server-down dry-run & palsu"                                   test_server_down_dry_and_fake
t "net-down hanya pxe-test*"                                      test_net_down_only_pxe_test
t "kvm-run.sh m4 dry-run end-to-end (semua nama pxe-test-)"       test_kvm_run_dry_run_end_to_end
t "kvm-run.sh argumen invalid ditolak tanpa mutasi"               test_kvm_run_rejects_bad_args
t "kvm-run.sh node sisa run → batal tanpa menyentuh"              test_kvm_run_existing_node_aborts_without_touching
t "deploy-dashboard dry-run + dashboard.env tanpa secret"         test_deploy_dry_run_no_secrets
t "dnsmasq.conf terikat pxe0 (bind-interfaces)"                   test_dnsmasq_conf_bound
t "tanpa sudo, ssh hanya dengan key, tanpa ~/.ssh"                test_no_sudo_and_ssh_targets
t "verify-node.sh: symlink, gagal cepat tanpa env, cek AC-4.31"   test_verify_node_script
t "redact-evidence: token path/token=/\$6\$ disamarkan, exit 0"     test_redact_evidence_masks_secrets
t "redact-evidence: blob base64 berisi token/\$6\$/key disamarkan (B-5)" test_redact_evidence_masks_base64_secrets
t "redact-evidence: header private key → exit 1 tanpa isi"        test_redact_evidence_private_key_fails
t "redact-evidence: argumen salah → exit 2"                       test_redact_evidence_bad_args
t "kvm-run.sh finish() memanggil redact-evidence (gagal = FAIL)"  test_kvm_run_calls_redact_in_finish
# M5 (M5-T14): test infra milestone 5.
source "$(dirname "$0")/m5.sh"
# M6 (M6-T7): test infra milestone 6.
source "$(dirname "$0")/m6.sh"
# M6 (DEC-020 / BUG-M6-4): ekspor NFS server test.
source "$(dirname "$0")/m6-nfs.sh"
rm -rf "$SAFE_BIN"
rmdir "$SANDBOX_PARENT" 2>/dev/null || true
echo "hasil: $PASS lulus, $FAIL gagal"
((FAIL == 0)) || { printf '  gagal: %s\n' "${FAILED_TESTS[@]}"; exit 1; }
