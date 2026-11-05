# shellcheck shell=bash
# infra/test/m5.sh — test shell infra M5 (M5-T14, test-engineer). Di-source oleh run.sh (memakai
# harness.sh: virsh/ssh/socat PALSU + sandbox di dalam project; tanpa libvirt/ssh sungguhan).
#   AC-5.33 node.sh poweroff|start (hanya destroy / start + listener serial append; tolak nama)
#   AC-5.34 CR-4-13 cleanup.sh menolak run id yang bertabrakan dengan pxe-test-server*; disk server aman
#   AC-5.35 CR-4-14 redact-evidence.sh: biner tidak diubah; biner bersecret → exit 1
#   AC-5.36 CR-4-12 assert-server-logs.sh PASS/FAIL → results.json; dry-run peran destroy
#   AC-5.37 nginx-pxe.conf statis (allowlist admin, /boot & /media terbuka, SSE) + bash -n

# ---- AC-5.33 ---------------------------------------------------------------------------------
test_m5_node_poweroff_start_fake() {
  echo yes > "$FAKE_STATE/net/pxe-test"
  run_infra node.sh create pxe-test-m5-node11 52:54:00:99:00:11 uefi
  assert_eq "$RC" 0 "$OUT"
  touch "$FAKE_STATE/dom/pxe-test-m5-node11.nvram"
  local disk="$PXE_AGENT_DIR/vms/pxe-test-m5-node11.qcow2" console="$PXE_RUNS_DIR/pxe-test-m5-node11-console.log"
  echo "sebelum poweroff" >> "$console"
  : > "$FAKE_LOG"
  run_infra node.sh poweroff pxe-test-m5-node11
  assert_eq "$RC" 0 "$OUT"
  # Hanya `virsh destroy` (tanpa undefine, tanpa rm disk/NVRAM).
  assert_eq "$(mutating_calls)" "virsh -c qemu:///system destroy pxe-test-m5-node11"
  assert_no_match "$(cat "$FAKE_LOG")" "undefine|rm "
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-m5-node11")" "shut off"
  assert_file "$disk"; assert_file "$FAKE_STATE/dom/pxe-test-m5-node11.nvram"
  # poweroff kedua (sudah mati): tanpa mutasi.
  : > "$FAKE_LOG"; run_infra node.sh poweroff pxe-test-m5-node11
  assert_eq "$RC" 0 "$OUT"; assert_empty "$(mutating_calls)"
  # start: listener serial disambung (append, isi lama tetap) lalu virsh start.
  : > "$FAKE_LOG"
  run_infra node.sh start pxe-test-m5-node11 52:54:00:99:00:11
  assert_eq "$RC" 0 "$OUT"
  local log; log="$(cat "$FAKE_LOG")"
  assert_match "$log" "^socat -u TCP-LISTEN:45017,bind=127\.0\.0\.1,reuseaddr OPEN:$console,creat,append$"
  assert_eq "$(mutating_calls | grep '^virsh')" "virsh -c qemu:///system start pxe-test-m5-node11"
  local sl vl; sl="$(grep -n '^socat' "$FAKE_LOG" | head -1 | cut -d: -f1)"; vl="$(grep -n 'virsh .* start ' "$FAKE_LOG" | cut -d: -f1)"
  ((sl < vl)) || _fail "listener serial harus dinyalakan sebelum virsh start"
  assert_contains "$(cat "$console")" "sebelum poweroff" "console lama terpotong (bukan append)"
  assert_contains "$(cat "$console")" "serial capture restart"
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-m5-node11")" running
  assert_file "$disk"
  # start tanpa MAC: MAC dibaca dari dumpxml (palsu: tidak ada) → tetap start, tanpa socat.
  run_infra node.sh poweroff pxe-test-m5-node11
  : > "$FAKE_LOG"; run_infra node.sh start pxe-test-m5-node11
  assert_eq "$RC" 0 "$OUT"; assert_match "$(mutating_calls)" "virsh -c qemu:///system start pxe-test-m5-node11"
  # start node yang tidak ada → gagal tanpa mutasi.
  : > "$FAKE_LOG"; run_infra node.sh start pxe-test-m5-node19 52:54:00:99:00:19
  assert_ne "$RC" 0; assert_empty "$(mutating_calls)"
}

test_m5_node_poweroff_start_dry_run() {
  export INFRA_DRY_RUN=1
  run_infra node.sh poweroff pxe-test-m5-node11
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(grep '^DRY-RUN:' <<<"$OUT")" "DRY-RUN: virsh -c qemu:///system destroy pxe-test-m5-node11"
  run_infra node.sh start pxe-test-m5-node11 52:54:00:99:00:11
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(grep '^DRY-RUN:' <<<"$OUT")" "DRY-RUN: virsh -c qemu:///system start pxe-test-m5-node11"
  assert_empty "$(mutating_calls)"
}

test_m5_node_poweroff_start_reject_names() {
  local a n
  echo running > "$FAKE_STATE/dom/pxe-test-node01"; echo "shut off" > "$FAKE_STATE/dom/ubuntu24.04"
  echo running > "$FAKE_STATE/dom/pxe-test-server"
  for a in poweroff start; do
    for n in pxe-test-node01 ubuntu24.04 default int pxe-test-server pxe-test-server-base vm-lain m5-node11 "../pxe-test-m5-node11" "pxe-test-m5-node11;id"; do
      : > "$FAKE_LOG"
      run_infra node.sh "$a" "$n" 52:54:00:99:00:11
      assert_ne "$RC" 0 "node.sh $a $n"
      assert_eq "$(cat "$FAKE_LOG")" "" "node.sh $a $n memanggil perintah"
      INFRA_DRY_RUN=1 run_infra node.sh "$a" "$n"
      assert_ne "$RC" 0 "dry-run node.sh $a $n"
      assert_no_match "$OUT" "^DRY-RUN: virsh"
    done
  done
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-node01")" running
  assert_eq "$(cat "$FAKE_STATE/dom/ubuntu24.04")" "shut off"
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-server")" running
}

# ---- AC-5.34 ---------------------------------------------------------------------------------
test_m5_cleanup_rejects_server_prefix() {
  local v="$PXE_AGENT_DIR/vms" id
  for f in pxe-test-server-base pxe-test-server pxe-test-m5-node11; do : > "$v/$f.qcow2"; done
  echo test > "$v/pxe-test-server-base.ready"
  echo running > "$FAKE_STATE/dom/pxe-test-server"; echo yes > "$FAKE_STATE/net/pxe-test-nat"
  local before; before="$(ls -l "$v" | sha256sum)"
  for id in server server1 serverx servers nat natx; do
    for extra in "" --server; do
      : > "$FAKE_LOG"
      run_infra cleanup.sh "$id" $extra
      assert_ne "$RC" 0 "cleanup.sh $id $extra diterima"
      assert_contains "$OUT" "bertabrakan"
      assert_eq "$(cat "$FAKE_LOG")" "" "cleanup.sh $id memanggil perintah"
    done
  done
  assert_eq "$(ls -l "$v" | sha256sum)" "$before" "disk berubah"
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-server")" running
}

test_m5_cleanup_m5_keeps_server_disks() {
  local v="$PXE_AGENT_DIR/vms"
  for f in pxe-test-server-base pxe-test-server pxe-test-m5-node11 pxe-test-m5-node12 pxe-test-m4-node11; do : > "$v/$f.qcow2"; done
  echo test > "$v/pxe-test-server-base.ready"
  echo "shut off" > "$FAKE_STATE/dom/pxe-test-m5-node11"; touch "$FAKE_STATE/dom/pxe-test-m5-node11.nvram"
  echo running > "$FAKE_STATE/dom/pxe-test-server"
  for n in pxe-test pxe-test-nat default int; do echo yes > "$FAKE_STATE/net/$n"; done
  echo running > "$FAKE_STATE/dom/pxe-test-node01"; echo "shut off" > "$FAKE_STATE/dom/ubuntu24.04"
  run_infra cleanup.sh m5
  assert_eq "$RC" 0 "$OUT"
  assert_no_file "$v/pxe-test-m5-node11.qcow2"
  assert_no_file "$v/pxe-test-m5-node12.qcow2"
  assert_file "$v/pxe-test-server-base.qcow2"
  assert_file "$v/pxe-test-server-base.ready"
  assert_file "$v/pxe-test-server.qcow2"
  assert_file "$v/pxe-test-m4-node11.qcow2"
  assert_no_file "$FAKE_STATE/dom/pxe-test-m5-node11"
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-server")" running
  assert_no_match "$(mutating_calls)" "pxe-test-server"
  # --server: overlay server dihapus, base disk tetap.
  run_infra cleanup.sh m5 --server
  assert_eq "$RC" 0 "$OUT"
  assert_no_file "$v/pxe-test-server.qcow2"
  assert_file "$v/pxe-test-server-base.qcow2"
  assert_file "$v/pxe-test-server-base.ready"
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-node01")" running
  assert_eq "$(cat "$FAKE_STATE/dom/ubuntu24.04")" "shut off"
}

# ---- AC-5.35 ---------------------------------------------------------------------------------
_png_bytes() { printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00'; }
test_m5_redact_binary_untouched_text_redacted() {
  local d="$SB/evidence" tok sum_png
  tok="$(_fake_token)"
  mkdir -p "$d/screenshots"
  { _png_bytes; printf 'IDATxyz\x00\x00\x00\x00IEND\xaeB`\x82'; } > "$d/screenshots/shot.png"
  sum_png="$(sha256sum < "$d/screenshots/shot.png")"
  echo "GET /boot/52:54:00:99:00:11/$tok/user-data 200" > "$d/nginx.txt"
  run_infra redact-evidence.sh "$d"
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(sha256sum < "$d/screenshots/shot.png")" "$sum_png" "PNG tanpa secret diubah"
  assert_eq "$(cat "$d/nginx.txt")" "GET /boot/52:54:00:99:00:11/REDACTED-TOKEN/user-data 200"
  assert_contains "$OUT" "1 biner"
}

test_m5_redact_binary_with_secret_fails_unchanged() {
  local d="$SB/evidence" tok hash s1 s2
  tok="$(_fake_token)"; hash="$(_fake_hash)"
  mkdir -p "$d"
  { _png_bytes; printf 'tEXt\x00url /boot/52:54:00:99:00:11/%s/status\x00' "$tok"; } > "$d/token.png"
  { printf '\x00\x01\x02bin\x00'; printf '%s' "$hash"; printf '\x00'; } > "$d/hash.bin"
  echo "baris aman" > "$d/ok.txt"
  s1="$(sha256sum < "$d/token.png")"; s2="$(sha256sum < "$d/hash.bin")"
  run_infra redact-evidence.sh "$d"
  assert_eq "$RC" 1 "biner bersecret harus exit 1: $OUT"
  assert_eq "$(sha256sum < "$d/token.png")" "$s1" "biner diubah in-place"
  assert_eq "$(sha256sum < "$d/hash.bin")" "$s2" "biner diubah in-place"
  assert_contains "$OUT" "token.png"
  assert_contains "$OUT" "hash.bin"
  assert_not_contains "$OUT" "ok.txt"
  assert_not_contains "$OUT" "$tok"
}

# ---- AC-5.36 ---------------------------------------------------------------------------------
_m5_server_logs() {
  local d="$1" ngx_n11="$2" with_tftp="$3"
  {
    echo "Nov  5 16:48:40 dnsmasq-dhcp[1]: DHCPACK(pxe0) 10.99.0.184 52:54:00:99:00:11"
    [[ "$with_tftp" == 1 ]] && echo "Nov  5 16:48:41 dnsmasq-tftp[1]: sent /srv/pxe/tftp/snponly.efi to 10.99.0.184"
    echo "Nov  5 16:48:42 dnsmasq-dhcp[1]: DHCPACK(pxe0) 10.99.0.185 52:54:00:99:00:12"
    echo "Nov  5 16:48:43 dnsmasq-tftp[1]: sent /srv/pxe/tftp/undionly.kpxe to 10.99.0.185"
  } > "$d/server-dnsmasq.txt"
  {
    local i
    for ((i = 0; i < ngx_n11; i++)); do echo "10.99.0.184 [2026-11-05T16:49:0${i}+00:00] \"GET /boot/52:54:00:99:00:11/***/user-data\" 200 2048 \"curl\""; done
    echo "10.99.0.185 [2026-11-05T17:10:00+00:00] \"GET /boot/52:54:00:99:00:12/***/user-data\" 200 2048 \"curl\""
    echo "10.99.0.185 [2026-11-05T17:10:01+00:00] \"GET /boot/52:54:00:99:00:12/***/meta-data\" 404 10 \"curl\""
  } > "$d/server-nginx.txt"
}
test_m5_assert_server_logs_pass() {
  local d="$SB/runs-kvm"; mkdir -p "$d"
  _m5_server_logs "$d" 2 1
  echo '{"run": "m5", "results": [{"ac": "AC-5.39", "status": "PASS"}]}' > "$d/results.json"
  run_infra assert-server-logs.sh "$d" pxe-test-m5-node11=52:54:00:99:00:11=uefi=2 pxe-test-m5-node12=52:54:00:99:00:12=bios=1
  assert_eq "$RC" 0 "$OUT"
  local r; r="$(cat "$d/results.json")"
  assert_contains "$r" '"ac": "CR-4-12-dnsmasq", "node": "pxe-test-m5-node11", "status": "PASS"'
  assert_contains "$r" '"ac": "CR-4-12-nginx", "node": "pxe-test-m5-node11", "status": "PASS"'
  assert_contains "$r" '"ac": "CR-4-12-nginx", "node": "pxe-test-m5-node12", "status": "PASS"'
  assert_contains "$r" '"ac": "AC-5.39", "status": "PASS"' "entri lama hilang"
  assert_not_contains "$r" '"ac": "CR-4-12-dnsmasq", "node": "pxe-test-m5-node12"' # BIOS: tanpa cek snponly
  assert_match "$(cat "$d/server-log-asserts.txt")" "^PASS +CR-4-12-nginx +pxe-test-m5-node11 +user-data 200 x2 \(min 2\)"
  # JSON tetap valid (sed in-place).
  grep -q '^{' "$d/results.json" && grep -q '}$' "$d/results.json" || _fail "results.json rusak"
}
test_m5_assert_server_logs_fail() {
  local d="$SB/runs-kvm" r
  mkdir -p "$d"
  # Tanpa TFTP snponly.efi untuk node UEFI → FAIL dnsmasq.
  _m5_server_logs "$d" 2 0
  run_infra assert-server-logs.sh "$d" pxe-test-m5-node11=52:54:00:99:00:11=uefi=2
  assert_eq "$RC" 1 "$OUT"
  r="$(cat "$d/results.json")"
  assert_contains "$r" '"ac": "CR-4-12-dnsmasq", "node": "pxe-test-m5-node11", "status": "FAIL"'
  assert_contains "$r" '"ac": "CR-4-12-nginx", "node": "pxe-test-m5-node11", "status": "PASS"'
  # user-data hanya sekali padahal node destroy butuh 2 → FAIL nginx.
  rm -f "$d/results.json"
  _m5_server_logs "$d" 1 1
  run_infra assert-server-logs.sh "$d" pxe-test-m5-node11=52:54:00:99:00:11=uefi=2
  assert_eq "$RC" 1 "$OUT"
  assert_contains "$(cat "$d/results.json")" '"ac": "CR-4-12-nginx", "node": "pxe-test-m5-node11", "status": "FAIL"'
  # Log nginx tidak ada → FAIL; argumen salah → 2.
  rm -f "$d/server-nginx.txt" "$d/results.json"
  run_infra assert-server-logs.sh "$d" pxe-test-m5-node12=52:54:00:99:00:12=bios
  assert_eq "$RC" 1 "$OUT"
  run_infra assert-server-logs.sh "$d" "x=52:54:00:99:00:12=bios"
  assert_eq "$RC" 2 "$OUT"
  run_infra assert-server-logs.sh "$d"
  assert_eq "$RC" 2 "$OUT"
}
test_m5_kvm_run_dry_run_destroy_role() {
  [[ -f "$INFRA_DIR_UNDER_TEST/tftp/snponly.efi" ]] || _fail "infra/tftp/snponly.efi tidak ada (prasyarat)"
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1 PXE_RUN=m5
  run_infra kvm-run.sh m5 --nodes "11:uefi:destroy 12:bios"
  assert_eq "$RC" 0 "$(tail -20 <<<"$OUT")"
  OUT="$(unq "$OUT")"
  assert_empty "$(mutating_calls)"
  local po st
  po="$(grep -E '^DRY-RUN: .*/infra/node\.sh poweroff ' <<<"$OUT" || true)"
  st="$(grep -E '^DRY-RUN: .*/infra/node\.sh start ' <<<"$OUT" || true)"
  assert_match "$po" "node\.sh poweroff pxe-test-m5-node11$"
  assert_match "$st" "node\.sh start pxe-test-m5-node11 52:54:00:99:00:11$"
  assert_eq "$(wc -l <<<"$po")" 1; assert_eq "$(wc -l <<<"$st")" 1
  assert_not_contains "$po$st" "node12"
  assert_match "$OUT" "PXE_KVM_SPEC=m5 "
  assert_match "$OUT" "PXE_KVM_DESTROY_NODES=pxe-test-m5-node11 "
  assert_match "$OUT" "PXE_KVM_POWER_CMD=.*/infra/node\.sh "
  # Tanpa :destroy → tidak ada poweroff/start sama sekali.
  run_infra kvm-run.sh m5 --nodes "11:uefi 12:bios"
  assert_eq "$RC" 0
  assert_no_match "$(unq "$OUT")" "node\.sh (poweroff|start) "
  # Peran tak dikenal ditolak tanpa mutasi.
  run_infra kvm-run.sh m5 --nodes "11:uefi:reboot"
  assert_ne "$RC" 0; assert_empty "$(mutating_calls)"
}
test_m5_kvm_run_asserts_and_exports_in_finish() {
  local k; k="$(sed -n '/^finish()/,/^}/p' "$INFRA_DIR_UNDER_TEST/kvm-run.sh")"
  assert_contains "$k" "assert_server_logs"
  assert_contains "$k" "step server-logs FAIL"
  # Ekspor log job sebelum redaksi (urutan di finish: evidence → server-logs → redact).
  local le lr; le="$(grep -n 'collect_evidence$' <<<"$k" | head -1 | cut -d: -f1)"; lr="$(grep -n 'redact-evidence.sh' <<<"$k" | head -1 | cut -d: -f1)"
  ((le < lr)) || _fail "collect_evidence (ekspor log job) harus sebelum redaksi"
  assert_contains "$(sed -n '/^collect_evidence()/,/^}/p' "$INFRA_DIR_UNDER_TEST/kvm-run.sh")" "export_job_logs"
  assert_contains "$(sed -n '/^export_job_logs()/,/^}/p' "$INFRA_DIR_UNDER_TEST/kvm-run.sh")" 'logs?format=json'
}

# ---- AC-5.37 ---------------------------------------------------------------------------------
# Blok `location <pola> { ... }` dari nginx-pxe.conf (tanpa komentar).
_ngx_block() { sed -e 's/#.*$//' "$INFRA_DIR_UNDER_TEST/server/nginx-pxe.conf" | awk -v pat="$1" '
  index($0, "location " pat " {") { inb = 1; depth = 0 }
  inb { print; depth += gsub(/\{/, "{"); depth -= gsub(/\}/, "}"); if (depth == 0) exit }'; }
test_m5_nginx_allowlist_static() {
  local conf="$INFRA_DIR_UNDER_TEST/server/nginx-pxe.conf" boot media root sse app
  boot="$(_ngx_block /boot/)"; media="$(_ngx_block /media/)"; root="$(_ngx_block /)"
  sse="$(_ngx_block '~ ^/api/jobs/[A-Za-z0-9_-]+/logs$')"; app="$(_ngx_block @app)"
  for b in boot media root sse app; do [[ -n "${!b}" ]] || _fail "blok $b tidak ditemukan"; done
  assert_no_match "$boot" "\b(allow|deny)\b" "/boot/ dibatasi"
  assert_no_match "$media" "\b(allow|deny)\b" "/media/ dibatasi"
  assert_match "$root" "allow 10\.99\.0\.1;"
  assert_match "$root" "deny all;"
  # allow sebelum deny (urutan nginx = pertama cocok).
  (( $(grep -n 'allow' <<<"$root" | head -1 | cut -d: -f1) < $(grep -n 'deny all' <<<"$root" | cut -d: -f1) )) || _fail "allow harus sebelum deny all"
  assert_match "$sse" "allow 10\.99\.0\.1;"; assert_match "$sse" "deny all;"
  assert_match "$sse" "proxy_buffering off;"
  assert_match "$sse" "gzip off;"
  local t; t="$(grep -oE 'proxy_read_timeout [0-9]+s' <<<"$sse" | grep -oE '[0-9]+')"
  [[ -n "$t" && "$t" -ge 3600 ]] || _fail "proxy_read_timeout SSE < 3600s ($t)"
  # Tidak ada lokasi lain yang membuka /api tanpa allowlist (mis. prefix /api/ terpisah).
  assert_no_match "$(grep -E '^\s*location' "$conf")" "location +(/api|= /api|\^~ /api)"
  # Header forwarding klien dibuang di jalur app/SSE (IP hanya dari X-Real-IP).
  for b in sse app; do assert_match "${!b}" 'proxy_set_header X-Forwarded-Host "";'; assert_match "${!b}" 'proxy_set_header X-Real-IP \$remote_addr;'; done
  # Penanda PXE_ADMIN_ALLOW ada di kedua allow (diganti deploy-dashboard.sh).
  assert_eq "$(grep -c 'allow 10.99.0.1; # PXE_ADMIN_ALLOW' "$conf")" 2
  # install-dashboard.sh menjalankan nginx -t sebelum reload.
  assert_match "$(cat "$INFRA_DIR_UNDER_TEST/server/install-dashboard.sh")" "^nginx -t"
}
test_m5_deploy_admin_allow_validated() {
  export INFRA_DRY_RUN=1
  PXE_ADMIN_ALLOW="10.99.0.0/24" run_infra deploy-dashboard.sh
  assert_eq "$RC" 0 "$OUT"
  local a
  for a in "0.0.0.0/0;" "all" "10.99.0.1; allow all" "::1" "evil.example"; do
    PXE_ADMIN_ALLOW="$a" run_infra deploy-dashboard.sh
    assert_ne "$RC" 0 "PXE_ADMIN_ALLOW='$a' diterima"
    assert_empty "$(mutating_calls)"
  done
}
test_m5_bash_n_all_scripts() {
  local f
  while IFS= read -r f; do bash -n "$f" || _fail "bash -n $f"; done < <(find "$INFRA_DIR_UNDER_TEST" "$REPO_UNDER_TEST/dashboard/e2e-kvm" -name '*.sh' -type f)
  assert_file "$INFRA_DIR_UNDER_TEST/assert-server-logs.sh"
}

t "M5 node.sh poweroff=destroy saja, start=listener append + start (AC-5.33)" test_m5_node_poweroff_start_fake
t "M5 node.sh poweroff/start dry-run (AC-5.33)"                     test_m5_node_poweroff_start_dry_run
t "M5 node.sh poweroff/start menolak nama terlindungi (AC-5.33)"     test_m5_node_poweroff_start_reject_names
t "M5 cleanup.sh run id server*/nat* ditolak tanpa virsh/rm (AC-5.34)" test_m5_cleanup_rejects_server_prefix
t "M5 cleanup.sh m5 tidak menyentuh disk server (AC-5.34)"           test_m5_cleanup_m5_keeps_server_disks
t "M5 redact: PNG bersih utuh, teks disamarkan (AC-5.35)"           test_m5_redact_binary_untouched_text_redacted
t "M5 redact: biner bersecret tidak diubah, exit 1 (AC-5.35)"       test_m5_redact_binary_with_secret_fails_unchanged
t "M5 assert-server-logs PASS → results.json (AC-5.36)"             test_m5_assert_server_logs_pass
t "M5 assert-server-logs FAIL → exit≠0 (AC-5.36)"                   test_m5_assert_server_logs_fail
t "M5 kvm-run dry-run: poweroff/start hanya node destroy (AC-5.36)" test_m5_kvm_run_dry_run_destroy_role
t "M5 kvm-run finish: asersi log + ekspor job sebelum redaksi"       test_m5_kvm_run_asserts_and_exports_in_finish
t "M5 nginx-pxe.conf allowlist admin + SSE (AC-5.37)"               test_m5_nginx_allowlist_static
t "M5 deploy PXE_ADMIN_ALLOW divalidasi (AC-5.37)"                  test_m5_deploy_admin_allow_validated
t "M5 bash -n semua script infra + e2e-kvm (AC-5.37)"               test_m5_bash_n_all_scripts
