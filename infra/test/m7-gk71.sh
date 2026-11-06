# shellcheck shell=bash
# infra/test/m7-gk71.sh — GK-7-1 (DEC-028 §1): race SIGPIPE overlay admin.env di deploy-dashboard.sh.
# Di-source oleh run.sh SETELAH m6.sh (memakai M6_HASH, M6_PASS, _m6_fake_dash).
#
# Penulis lambat disuntikkan lewat fungsi bash `printf` yang diekspor (bash di run_infra mewarisinya
# dan fungsi menang atas builtin): pemanggilan printf baris PXE_ADMIN_USERNAME tidur dulu lalu
# meneruskan ke builtin dan menandai file. Tanpa perbaikan (dry-run mem-pipe ke `run` yang tidak
# membaca stdin) penulis selalu kalah cepat -> SIGPIPE -> exit 141 (reproduksi deterministik
# flaky-ac717). Dengan perbaikan, dry-run tidak menjalankan blok penulis sama sekali.

_gk71_slow_printf_on() {
  export GK71_MARK="$SB/slow-printf.mark"
  printf() {
    if [[ "${1:-}" == PXE_ADMIN_USERNAME=* ]]; then
      sleep 0.4
      echo hit >> "$GK71_MARK"
    fi
    builtin printf "$@"
  }
  export -f printf
}
_gk71_slow_printf_off() { unset -f printf; }

# (a) Regresi: dry-run + penulis lambat (flat dan VLAN) -> exit 0, perintah overlay tetap dicetak.
test_gk71_dry_run_slow_writer_exit0() {
  export INFRA_DRY_RUN=1 PXE_RUN=m7gk71
  local topo
  for topo in flat vlan; do
    _gk71_slow_printf_on
    run_infra deploy-dashboard.sh --topology "$topo"
    _gk71_slow_printf_off
    assert_eq "$RC" 0 "dry-run $topo penulis lambat (141 = SIGPIPE GK-7-1): $OUT"
    assert_match "$(unq "$OUT")" "DRY-RUN: ssh .* pxe@10\.99\.0\.2 umask 077 && cat > '/tmp/pxe-test-deploy\.[0-9TZ]+/admin\.env'"
    assert_match "$(unq "$OUT")" "DRY-RUN: ssh .* root@10\.99\.0\.2 RELEASE_TS=.* bash -s"
    assert_empty "$(mutating_calls)" "dry-run $topo memutasi"
    # Hash/password tidak pernah dicetak di dry-run.
    assert_not_contains "$OUT" 'scrypt$'
    assert_not_contains "$OUT" "PXE_ADMIN_PASSWORD_HASH="
  done
  # Dry-run tidak menjalankan blok penulis (tidak ada pipe ke konsumen yang tak membaca stdin).
  assert_no_file "$GK71_MARK"
}

# (b) Non-dry (ssh palsu yang MEMBACA stdin) dengan penulis lambat: env admin tetap dikirim lewat
# stdin ssh, utuh, ke perintah `umask 077 && cat > …/admin.env`; tidak ada di argv.
test_gk71_non_dry_sends_admin_env_via_stdin() {
  export PXE_DASHBOARD_DIR; PXE_DASHBOARD_DIR="$(_m6_fake_dash)"
  export SKIP_BUILD=1 PXE_RUN=m7gk71 FAKE_ADMIN_HASH="$M6_HASH" FAKE_CURL_HTTP=1
  export FAKE_SSH_STDIN_LOG="$SB/ssh-stdin.log" PXE_DEPLOY_BOOTING_TIMEOUT_MIN=120
  export FAKE_CURL_SETTINGS_BODY='{"cidr":"10.99.0.0/24","auth":{"adminUsername":"pxeadmin","adminConfigured":true}}'
  echo running > "$FAKE_STATE/dom/pxe-test-server"
  : > "$PXE_AGENT_DIR/keys/infra_ed25519"
  (umask 077; printf '%s' "$M6_PASS" > "$PXE_AGENT_DIR/keys/m7gk71-admin.pass")
  _gk71_slow_printf_on
  run_infra deploy-dashboard.sh
  _gk71_slow_printf_off
  assert_eq "$RC" 0 "$OUT"
  # Blok penulis dijalankan (jalur pipe non-dry tetap ada) tepat sekali.
  assert_eq "$(cat "$GK71_MARK" 2>/dev/null)" "hit" "penulis env admin non-dry tidak dijalankan"
  # Satu pemanggilan ssh ke admin.env, sebagai user pxe, dengan umask 077 di VM.
  local cmd_re="^ssh .* pxe@10\.99\.0\.2 umask 077 && cat > '/tmp/pxe-test-deploy\.[0-9TZ]+/admin\.env'$"
  assert_eq "$(grep -cE "$cmd_re" "$FAKE_LOG")" 1 "$(cat "$FAKE_LOG")"
  # Isi stdin pemanggilan itu persis tiga baris env admin.
  local blk
  blk="$(awk '/^### ssh umask 077 && cat > .*\/admin\.env.$/{f=1;next} /^### /{f=0} f' "$FAKE_SSH_STDIN_LOG")"
  assert_eq "$blk" "PXE_ADMIN_USERNAME=pxeadmin
PXE_ADMIN_PASSWORD_HASH='$M6_HASH'
PXE_JOB_BOOTING_TIMEOUT_MIN=120" "stdin admin.env"
  # Hash/password tidak di argv maupun keluaran.
  assert_not_contains "$(cat "$FAKE_LOG")" "$M6_HASH"
  assert_not_contains "$(cat "$FAKE_LOG")" "$M6_PASS"
  assert_not_contains "$OUT" "$M6_HASH"
  assert_not_contains "$OUT" "$M6_PASS"
}

t "GK-7-1 deploy dry-run penulis lambat flat+vlan → exit 0, tanpa pipe (DEC-028 §1)" test_gk71_dry_run_slow_writer_exit0
t "GK-7-1 deploy non-dry: env admin lewat stdin ssh (umask 077), penulis lambat" test_gk71_non_dry_sends_admin_env_via_stdin
