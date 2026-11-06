# shellcheck shell=bash
# infra/test/m6-bug10.sh — BUG-M6-10: kvm-run.sh berhenti setelah verifikasi node PERTAMA bila
# Playwright lulus (`VERIFY_NOTE[$i]="…$( ((e2e_rc != 0)) && echo …)"` berstatus 1 di bawah set -e).
# Di-source run.sh. Jalur verifikasi non-dry dijalankan lewat PXE_KVM_DRY_VERIFY_EXEC=1 (dry-run)
# terhadap ssh PALSU (fake-bin/ssh: login password ditolak "publickey", FAKE_SSH_FAIL_IP), Playwright
# disimulasikan PXE_KVM_DRY_PLAYWRIGHT_RC, virsh palsu. Tanpa KVM/jaringan sungguhan.

# _b10_verify <results.json> -> "[(nodeNN, status), ...]" entri verify-node
_b10_verify() { _m6_json "$1" '[(e["node"][-6:], e["status"]) for e in d["results"] if e["ac"]=="verify-node"]'; }
_b10_notes() { _m6_json "$1" '[e["note"] for e in d["results"] if e["ac"]=="verify-node"]'; }

# Playwright LULUS, 2 node (core, tanpa gelombang): kedua node diverifikasi, PASS, exit 0.
test_m6_bug10_playwright_pass_two_nodes() {
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1 PXE_KVM_DRY_VERIFY_EXEC=1
  run_infra kvm-run.sh m6 --scenario core
  assert_eq "$RC" 0 "$(tail -15 <<<"$OUT")"
  local r="$PXE_RUNS_DIR/core/results.json" k="$PXE_RUNS_DIR/core/kvm-run.txt"
  assert_eq "$(_b10_verify "$r")" "[('node21', 'PASS'), ('node22', 'PASS')]"
  assert_eq "$(_b10_notes "$r")" \
    "['verify-node.sh exit=0 + cek login password', 'verify-node.sh exit=0 + cek login password']"
  assert_match "$(cat "$k")" "verify +ok pxe-test-m6core-node21 "
  assert_match "$(cat "$k")" "verify +ok pxe-test-m6core-node22 "
  assert_match "$(cat "$k")" "result +PASS exit=0$"
  assert_eq "$(_m6_json "$r" 'd["harness"]["exit"]')" 0
  assert_eq "$(_m6_json "$r" 'd["harness"]["failedStage"]')" ""
  assert_eq "$(_m6_json "$PXE_RUNS_DIR/results.json" 'd["runs"]["core"]["status"]')" PASS
  # Jalur sungguhan dipakai (ssh palsu): verify-node + cek login password untuk KEDUA node.
  local n
  for n in 31 32; do
    assert_match "$(cat "$FAKE_LOG")" "^ssh .* m6admin@10\.99\.0\.$n EXPECT_HOSTNAME=m6-node$((n - 10)) "
    assert_match "$(cat "$FAKE_LOG")" "^ssh .*PreferredAuthentications=password .*m6admin@10\.99\.0\.$n true$"
    assert_match "$(cat "$PXE_RUNS_DIR/core/pxe-test-m6core-node$((n - 10))-verify.txt")" \
      "^OK   login password ditolak \(server hanya menawarkan: publickey\)$"
  done
}

# Playwright LULUS, 3 node --waves (max_nodes 1 -> 3 gelombang, verify_one dipanggil langsung):
# semua node diverifikasi, PASS, exit 0.
test_m6_bug10_playwright_pass_waves() {
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1 PXE_KVM_DRY_VERIFY_EXEC=1
  PXE_KVM_MEMINFO="$(_m6_meminfo "$(_m6_mem_for 1)")" run_infra kvm-run.sh m6 --scenario bulk --waves
  assert_eq "$RC" 0 "$(tail -15 <<<"$OUT")"
  local r="$PXE_RUNS_DIR/bulk/results.json"
  assert_eq "$(_b10_verify "$r")" "[('node25', 'PASS'), ('node26', 'PASS'), ('node27', 'PASS')]"
  assert_match "$(cat "$PXE_RUNS_DIR/bulk/kvm-run.txt")" "result +PASS exit=0$"
  assert_eq "$(_m6_json "$PXE_RUNS_DIR/results.json" 'd["runs"]["bulk"]["status"]')" PASS
  local n
  for n in 35 36 37; do assert_match "$(cat "$FAKE_LOG")" "^ssh .* m6admin@10\.99\.0\.$n EXPECT_HOSTNAME=m6-bulk-0$((n - 34)) "; done
}

# Playwright GAGAL (exit 1), kedua node done: keduanya diverifikasi (PASS) dengan catatan parsial,
# run tetap FAIL exit=1 (kode Playwright).
test_m6_bug10_playwright_fail_partial_note() {
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1 PXE_KVM_DRY_VERIFY_EXEC=1
  PXE_KVM_DRY_PLAYWRIGHT_RC=1 PXE_KVM_DRY_HOST_STATUS="52:54:00:99:00:21=done 52:54:00:99:00:22=done" \
    run_infra kvm-run.sh m6 --scenario core
  assert_eq "$RC" 1 "$(tail -15 <<<"$OUT")"
  local r="$PXE_RUNS_DIR/core/results.json"
  assert_eq "$(_b10_verify "$r")" "[('node21', 'PASS'), ('node22', 'PASS')]"
  local note
  note="verify-node.sh exit=0 + cek login password (verifikasi parsial, Playwright exit=1)"
  assert_eq "$(_b10_notes "$r")" "['$note', '$note']"
  assert_match "$(cat "$PXE_RUNS_DIR/core/kvm-run.txt")" "result +FAIL exit=1 stage=verify$"
  assert_eq "$(_m6_json "$r" 'd["harness"]["exit"]')" 1
  assert_eq "$(_m6_json "$PXE_RUNS_DIR/results.json" 'd["runs"]["core"]["status"]')" FAIL
}

# Playwright LULUS, verify-node node21 gagal: node22 tetap diverifikasi; run FAIL exit=1.
# Login password ditawarkan sshd -> FAIL walaupun verify-node lulus.
test_m6_bug10_verify_fail_continues() {
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1 PXE_KVM_DRY_VERIFY_EXEC=1
  FAKE_SSH_FAIL_IP=10.99.0.31 run_infra kvm-run.sh m6 --scenario core
  assert_eq "$RC" 1 "$(tail -15 <<<"$OUT")"
  local r="$PXE_RUNS_DIR/core/results.json"
  assert_eq "$(_b10_verify "$r")" "[('node21', 'FAIL'), ('node22', 'PASS')]"
  assert_match "$(_b10_notes "$r")" "^\['verify-node\.sh exit=1 \+ cek login password', "
  assert_match "$(cat "$PXE_RUNS_DIR/core/kvm-run.txt")" "verify +FAIL pxe-test-m6core-node21 "
  assert_match "$(cat "$PXE_RUNS_DIR/core/kvm-run.txt")" "result +FAIL exit=1 stage=verify$"
  rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
  FAKE_SSH_AUTH_METHODS=publickey,password run_infra kvm-run.sh m6 --scenario core
  assert_eq "$RC" 1
  assert_eq "$(_b10_verify "$PXE_RUNS_DIR/core/results.json")" "[('node21', 'FAIL'), ('node22', 'FAIL')]"
  assert_match "$(cat "$PXE_RUNS_DIR/core/pxe-test-m6core-node22-verify.txt")" "^FAIL login password tidak ditolak"
}

# Statis: pola `$( ((…)) && …)` / `$( [[ … ]] && …)` tanpa cabang `||` tidak boleh ada lagi.
test_m6_bug10_no_bare_and_substitution() {
  local hits
  # Fragmen "$( ((…)) && …" / "$([[ … ]] && …" sampai ')' berikutnya; aman hanya bila ada '||' setelah '&&'.
  hits="$(grep -noE '\$\( *(\(\([^)]*\)\)|\[\[[^]]*\]\]) *&&[^)]*' "$INFRA_DIR_UNDER_TEST/kvm-run.sh" | grep -vE '&&.*\|\|' || true)"
  assert_empty "$hits" "substitusi && tanpa ||"
}

t "M6 BUG-M6-10 Playwright lulus, 2 node -> keduanya diverifikasi, PASS"     test_m6_bug10_playwright_pass_two_nodes
t "M6 BUG-M6-10 Playwright lulus, --waves 3 node -> semua diverifikasi"      test_m6_bug10_playwright_pass_waves
t "M6 BUG-M6-10 Playwright gagal -> verifikasi parsial + catatan, FAIL"      test_m6_bug10_playwright_fail_partial_note
t "M6 BUG-M6-10 verify node1 gagal -> node2 tetap diverifikasi, FAIL"       test_m6_bug10_verify_fail_continues
t "M6 BUG-M6-10 tanpa \$( ((…)) && …) di kvm-run.sh (statis)"               test_m6_bug10_no_bare_and_substitution
