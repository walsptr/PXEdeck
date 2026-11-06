# shellcheck shell=bash
# infra/test/m6.sh — test shell infra M6 (M6-T7, backend-dev; dilengkapi test-engineer di T13).
# Di-source oleh run.sh (harness.sh: virsh/ssh/curl/npm PALSU + sandbox di dalam project).
#   AC-6.40 entri cleanup selalu ditulis ke results.json (gagal di tiap tahap + sukses)
#   AC-6.41 --waves (max_nodes 1/2/3 dari MemAvailable palsu), tanpa --waves ditolak, --scenario
#   AC-6.42 deploy admin: password 0600, hash/password tidak di argv/log, hanya via stdin;
#           verify-node.sh cek target bebas token (jumlah saja)
#   CR-5-10 results-json.py (escape benar, tanpa sed), assert-server-logs.sh -> JSON terpisah
#   O5      nginx limit_req (login + /boot/), allowlist DEC-015 tetap
#   guard   virsh_m menolak nama terlindungi

M6_PASS='Zq8xV3kP9mT2wR7yB4nL6cHd'   # password uji yang diketahui (bukan secret)
# Fixture uji bertanda (hash SINTETIS, bukan kredensial; AC-6.53):
M6_HASH='scrypt$15$8$1$c2FsdHNhbHRzYWx0c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA'

# Snapshot JSON lewat python (valid + kueri).
_m6_json() { python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))" "$@"; }
_m6_meminfo() { # _m6_meminfo <MemAvailable MB> -> path berkas meminfo palsu
  printf 'MemTotal:       %d kB\nMemAvailable:   %d kB\n' $((64 * 1024 * 1024)) $(($1 * 1024)) > "$SB/meminfo"
  echo "$SB/meminfo"
}
# MemAvailable (MB) agar max_nodes = N dengan server belum jalan (3072 MB dikurangkan).
_m6_mem_for() { echo $((3072 + 4096 + 2048 * $1 + 100)); }

# ---- AC-6.40 ---------------------------------------------------------------------------------
test_m6_cleanup_entry_every_stage() {
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1
  local st r
  for st in preflight net-up server-up deploy server-check nodes playwright verify; do
    rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
    PXE_KVM_DRY_FAIL_AT="$st" run_infra kvm-run.sh m6 --scenario core
    assert_ne "$RC" 0 "gagal di $st harus exit≠0"
    r="$PXE_RUNS_DIR/core/results.json"
    assert_file "$r"
    assert_eq "$(_m6_json "$r" '[e["ac"] for e in d["results"]].count("cleanup")')" 1 "$st: entri cleanup"
    assert_eq "$(_m6_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["failedStage"]')" "$st"
    assert_eq "$(_m6_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["protectedIdentical"]')" True "$st"
    assert_eq "$(_m6_json "$r" 'd["harness"]["failedStage"]')" "$st"
    assert_ne "$(_m6_json "$r" 'd["harness"]["exit"]')" 0
    for f in libvirt-before.txt libvirt-after.txt libvirt-diff.txt kvm-run.txt; do assert_file "$PXE_RUNS_DIR/core/$f"; done
    assert_match "$(cat "$PXE_RUNS_DIR/core/libvirt-diff.txt")" "protectedIdentical=true"
    # Ringkasan gabungan memuat run core berstatus FAIL.
    assert_eq "$(_m6_json "$PXE_RUNS_DIR/results.json" 'd["runs"]["core"]["status"]')" FAIL "$st"
    assert_match "$(cat "$PXE_RUNS_DIR/core/kvm-run.txt")" "result +FAIL exit=1 stage=$st"
    # Password admin run tidak tertinggal.
    assert_no_file "$PXE_AGENT_DIR/keys/m6core-admin.pass"
    assert_empty "$(mutating_calls)" "$st: dry-run mengeksekusi mutasi"
  done
  # Run sukses juga memuat entri cleanup (PASS) dan failedStage kosong.
  rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
  run_infra kvm-run.sh m6 --scenario core
  assert_eq "$RC" 0 "$(tail -20 <<<"$OUT")"
  r="$PXE_RUNS_DIR/core/results.json"
  assert_eq "$(_m6_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["status"]')" PASS
  assert_eq "$(_m6_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["failedStage"]')" ""
  assert_eq "$(_m6_json "$PXE_RUNS_DIR/results.json" 'sorted(d["runs"].keys())')" "['core']"
  assert_eq "$(cat "$FAKE_STATE/dom/pxe-test-node01")" running
  assert_eq "$(cat "$FAKE_STATE/net/default")" yes
}

test_m6_cleanup_entry_protected_changed_fails() {
  # Resource terlindungi berubah selama run (virsh palsu: pxe-test-node01 jadi "paused" setelah
  # snapshot before) -> entri cleanup FAIL, protectedIdentical false, run exit≠0.
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1
  FAKE_VIRSH_FLIP_AFTER_FIRST_LIST=pxe-test-node01 run_infra kvm-run.sh m6 --scenario distro
  assert_ne "$RC" 0 "$(tail -5 <<<"$OUT")"
  local r="$PXE_RUNS_DIR/distro/results.json"
  assert_eq "$(_m6_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["status"]')" FAIL
  assert_eq "$(_m6_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["protectedIdentical"]')" False
  assert_match "$(_m6_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["note"]')" "pxe-test-node01 berubah"
  assert_match "$(cat "$PXE_RUNS_DIR/distro/libvirt-diff.txt")" "^\+dom pxe-test-node01 paused"
  # Harness sendiri tidak pernah memutasi resource itu.
  assert_no_match "$(mutating_calls)" "pxe-test-node01"
}

# ---- AC-6.41 ---------------------------------------------------------------------------------
_m6_waves_run() { # _m6_waves_run <max_nodes> [args...]
  local n="$1"; shift
  PXE_KVM_MEMINFO="$(_m6_meminfo "$(_m6_mem_for "$n")")" run_infra kvm-run.sh m6 --scenario bulk "$@"
  OUT="$(unq "$OUT")"
}
test_m6_waves() {
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1
  local n plan exp starts r
  for n in 1 2 3; do
    rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
    _m6_waves_run "$n" --waves
    assert_eq "$RC" 0 "max_nodes=$n: $(tail -20 <<<"$OUT")"
    assert_match "$OUT" "preflight +ok max_nodes=$n "
    # Rencana install: start per gelombang, lalu tunggu Done, lalu (bukan gelombang terakhir) poweroff.
    plan="$(grep -E '^(DRY-RUN: .*/node\.sh (start|poweroff) pxe-test-m6bulk|DRY-RUN-WAIT: gelombang [0-9]/[0-9] install)' <<<"$OUT" \
      | sed -E 's#^DRY-RUN: .*/node\.sh (start|poweroff) pxe-test-m6bulk-(node[0-9]+).*#\1 \2#; s#^DRY-RUN-WAIT: gelombang ([0-9]/[0-9]) install.*#wait \1#' | tr '\n' ';')"
    case "$n" in
      1) exp="poweroff node25;poweroff node26;poweroff node27;start node25;wait 1/3;poweroff node25;start node26;wait 2/3;poweroff node26;start node27;wait 3/3;start node25;poweroff node25;start node26;poweroff node26;start node27;" ;;
      2) exp="poweroff node25;poweroff node26;poweroff node27;start node25;start node26;wait 1/2;poweroff node25;poweroff node26;start node27;wait 2/2;start node25;start node26;poweroff node25;poweroff node26;start node27;" ;;
      3) exp="poweroff node25;poweroff node26;poweroff node27;start node25;start node26;start node27;wait 1/1;start node25;start node26;start node27;" ;;
    esac
    assert_eq "$plan" "$exp" "max_nodes=$n urutan gelombang"
    # Discover per gelombang: create gelombang k sebelum poweroff gelombang k, sebelum create k+1.
    assert_match "$OUT" "DRY-RUN-WAIT: gelombang 1/[0-9] discover: tunggu GET /boot/52:54:00:99:00:25\.ipxe"
    assert_match "$OUT" "PXE_KVM_MAX_NODES=$n "
    r="$PXE_RUNS_DIR/bulk/results.json"
    assert_eq "$(_m6_json "$r" 'd["harness"]["maxNodes"]')" "$n"
    assert_eq "$(_m6_json "$r" 'len(d["harness"]["waves"])')" $(( (3 + n - 1) / n ))
    # Gelombang > 1 -> booting timeout dinaikkan ke 120 dan dicatat.
    if ((n < 3)); then assert_eq "$(_m6_json "$r" 'd["harness"]["bootingTimeoutMin"]')" 120
    else assert_eq "$(_m6_json "$r" 'd["harness"]["bootingTimeoutMin"]')" None; fi
    # Hostname template bulk berurutan.
    assert_match "$OUT" "PXE_KVM_NODES=pxe-test-m6bulk-node25=52:54:00:99:00:25=uefi=10\.99\.0\.35=ubuntu=install=m6-bulk-01 "
    assert_empty "$(mutating_calls)"
  done
  # Gelombang 1 (max 2): PXE_KVM_WAVES berisi dua gelombang.
  rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
  _m6_waves_run 2 --waves
  assert_match "$OUT" "PXE_KVM_WAVES=pxe-test-m6bulk-node25,pxe-test-m6bulk-node26 pxe-test-m6bulk-node27 "
  # Tanpa --waves: 3 node dengan max_nodes=2 -> exit≠0 (perilaku lama), tanpa virt-install node.
  _m6_waves_run 2
  assert_ne "$RC" 0
  assert_contains "$OUT" "hanya cukup untuk 2 node"
  assert_no_match "$OUT" "virt-install .*--name pxe-test-m6bulk"
  # --booting-timeout-min eksplisit menang dan divalidasi.
  rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
  _m6_waves_run 1 --waves --booting-timeout-min 200
  assert_eq "$RC" 0
  assert_eq "$(_m6_json "$PXE_RUNS_DIR/bulk/results.json" 'd["harness"]["bootingTimeoutMin"]')" 200
  run_infra kvm-run.sh m6 --scenario bulk --booting-timeout-min 0
  assert_ne "$RC" 0
}

test_m6_scenarios_and_specs() {
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1
  run_infra kvm-run.sh m6 --scenario core
  assert_eq "$RC" 0 "$(tail -20 <<<"$OUT")"
  OUT="$(unq "$OUT")"
  assert_match "$OUT" "virt-install .*--name pxe-test-m6core-node21 .*mac=52:54:00:99:00:21"
  assert_match "$OUT" "virt-install .*--name pxe-test-m6core-node22 .*bios\.useserial"
  assert_match "$OUT" "PXE_KVM_RUN=m6core .*PXE_KVM_SCENARIO=core "
  assert_match "$OUT" "PXE_KVM_SPEC=m6 "
  assert_match "$OUT" "PXE_KVM_FAILPATH_NODES=pxe-test-m6core-node21 "
  assert_match "$OUT" "PXE_KVM_DESTROY_NODES=pxe-test-m6core-node22 "
  assert_match "$OUT" "PXE_KVM_ADMIN_USER=pxeadmin PXE_KVM_ADMIN_PASS_FILE=$PXE_AGENT_DIR/keys/m6core-admin\.pass "
  assert_match "$OUT" "ssh .* m6admin@10\.99\.0\.31 EXPECT_HOSTNAME=m6-node21 "
  assert_file "$PXE_RUNS_DIR/core/kvm-run.txt"
  run_infra kvm-run.sh m6 --scenario distro
  assert_eq "$RC" 0
  OUT="$(unq "$OUT")"
  assert_match "$OUT" "PXE_KVM_NODES=pxe-test-m6distro-node23=52:54:00:99:00:23=uefi=10\.99\.0\.33=debian=install=m6-node23 pxe-test-m6distro-node24=52:54:00:99:00:24=uefi=10\.99\.0\.34=rocky=install=m6-node24 "
  # Spec eksplisit dengan :failpath / :os=, dan spec invalid ditolak tanpa mutasi.
  run_infra kvm-run.sh m6 --nodes "31:bios:failpath:os=debian"
  assert_eq "$RC" 0
  assert_match "$(unq "$OUT")" "pxe-test-m6-node31=52:54:00:99:00:31=bios=10\.99\.0\.41=debian=failpath=m6-node31"
  local a
  for a in "--scenario evil" "--scenario" "--nodes 21:uefi:os=windows" "--nodes 21:uefi:destroy:failpath" "--nodes 21:uefi:os=rocky:destroy" "--nodes '21:uefi 22:uefi 23:uefi 24:uefi' --waves"; do
    : > "$FAKE_LOG"
    set +e; OUT="$(eval "bash '$INFRA_DIR_UNDER_TEST/kvm-run.sh' m6 $a" </dev/null 2>&1)"; RC=$?; set -e
    assert_ne "$RC" 0 "kvm-run m6 $a"
    assert_empty "$(mutating_calls)" "kvm-run m6 $a"
  done
  # Nama terlindungi tetap ditolak (regresi AC-5.33) — sebagai milestone/run id.
  for a in default int pxe-test-node01 ubuntu24.04; do
    run_infra kvm-run.sh "$a"; assert_ne "$RC" 0 "$a"
  done
}

# ---- guard resource terlindungi ---------------------------------------------------------------
test_m6_virsh_guard_protected() {
  local p
  for p in pxe-test-node01 ubuntu24.04 default int; do
    : > "$FAKE_LOG"
    set +e; OUT="$(bash -c 'source "$1/lib.sh"; virsh_m destroy "$2"' _ "$INFRA_DIR_UNDER_TEST" "$p" 2>&1)"; RC=$?; set -e
    assert_ne "$RC" 0 "$p"
    assert_contains "$OUT" "dilindungi"
    assert_empty "$(cat "$FAKE_LOG")" "virsh dipanggil untuk $p"
  done
  set +e; OUT="$(bash -c 'source "$1/lib.sh"; virsh_m undefine --nvram pxe-test-m6core-node21' _ "$INFRA_DIR_UNDER_TEST" 2>&1)"; set -e
  assert_match "$(cat "$FAKE_LOG")" "virsh -c qemu:///system undefine --nvram pxe-test-m6core-node21"
}

# ---- AC-6.42 ---------------------------------------------------------------------------------
_m6_fake_dash() { # build standalone palsu untuk deploy non-dry
  local d="$SB/dash"
  mkdir -p "$d/.next/standalone" "$d/.next/static/x" "$d/public"
  echo 'console.log(1)' > "$d/.next/standalone/server.js"; echo s > "$d/.next/static/x/a.js"
  echo "$d"
}
test_m6_deploy_admin_no_leak() {
  # Non-dry dengan ssh/curl/npm palsu: hash dihitung dari password via stdin, dikirim via stdin ssh.
  export PXE_DASHBOARD_DIR; PXE_DASHBOARD_DIR="$(_m6_fake_dash)"
  export SKIP_BUILD=1 PXE_RUN=m6core FAKE_ADMIN_HASH="$M6_HASH" FAKE_CURL_HTTP=1
  export FAKE_SSH_STDIN_LOG="$SB/ssh-stdin.log"
  export FAKE_CURL_SETTINGS_BODY='{"cidr":"10.99.0.0/24","auth":{"adminUsername":"pxeadmin","adminConfigured":true}}'
  echo running > "$FAKE_STATE/dom/pxe-test-server"
  : > "$PXE_AGENT_DIR/keys/infra_ed25519"
  local pf="$PXE_AGENT_DIR/keys/m6core-admin.pass"
  (umask 077; printf '%s' "$M6_PASS" > "$pf")
  run_infra deploy-dashboard.sh
  assert_eq "$RC" 0 "$OUT"
  # Password -> npm hanya lewat stdin; hash -> VM hanya lewat stdin ssh (overlay admin.env).
  assert_eq "$(cat "$FAKE_STATE/admin-hash.stdin")" "$M6_PASS"
  assert_contains "$(cat "$FAKE_SSH_STDIN_LOG")" "PXE_ADMIN_PASSWORD_HASH='$M6_HASH'"
  assert_contains "$(cat "$FAKE_SSH_STDIN_LOG")" "PXE_ADMIN_USERNAME=pxeadmin"
  assert_match "$(cat "$FAKE_LOG")" "ssh .* pxe@10\.99\.0\.2 umask 077 && cat > '/tmp/pxe-test-deploy\.[0-9TZ]+/admin\.env'"
  # Login: password lewat stdin curl.
  assert_contains "$(cat "$FAKE_STATE/curl-login.stdin")" "\"password\":\"$M6_PASS\""
  # Tidak ada password/hash di argv (FAKE_LOG), keluaran, atau log deploy.
  local where
  for where in "$(cat "$FAKE_LOG")" "$OUT" "$(cat "$PXE_RUNS_DIR/deploy-dashboard.txt")"; do
    assert_not_contains "$where" "$M6_PASS"; assert_not_contains "$where" "$M6_HASH"; assert_not_contains "$where" 'scrypt$15'
  done
  assert_match "$(cat "$PXE_RUNS_DIR/deploy-dashboard.txt")" "api/settings tanpa sesi -> 401"
  # Cookie jar sementara tidak tertinggal.
  assert_eq "$(ls -A "$TMPDIR")" ""
  assert_match "$(cat "$PXE_RUNS_DIR/deploy-dashboard.txt")" "POST /api/auth/login \(admin pxeadmin\) -> 204"
  assert_not_contains "$(cat "$PXE_RUNS_DIR/deploy-dashboard.txt")" "FAKESESSIONVALUE" "cookie sesi tercatat"
  # Login 200 (bukan 204) atau 204 tanpa cookie pxe_session -> deploy gagal (AC-6.5).
  FAKE_CURL_LOGIN_CODE=200 run_infra deploy-dashboard.sh
  assert_ne "$RC" 0 "login 200 diterima"; assert_contains "$OUT" "HTTP 200, wajib 204"
  FAKE_CURL_LOGIN_CODE=401 run_infra deploy-dashboard.sh
  assert_ne "$RC" 0 "login 401 diterima"
  FAKE_CURL_LOGIN_COOKIE=0 run_infra deploy-dashboard.sh
  assert_ne "$RC" 0 "login 204 tanpa cookie diterima"
  assert_eq "$(ls -A "$TMPDIR")" "" "cookie jar tertinggal setelah login gagal"
  # Mode file password != 0600 -> ditolak sebelum hash.
  chmod 644 "$pf"; : > "$FAKE_LOG"
  run_infra deploy-dashboard.sh
  assert_ne "$RC" 0; assert_contains "$OUT" "0600"; assert_no_match "$(cat "$FAKE_LOG")" "admin:hash"
  chmod 600 "$pf"
  # Keluaran helper bukan format scrypt -> gagal tanpa mencetak keluaran.
  FAKE_ADMIN_HASH="oops-$M6_PASS" run_infra deploy-dashboard.sh
  assert_ne "$RC" 0; assert_not_contains "$OUT" "$M6_PASS"
  # dashboard.env berisi hash nyata -> ditolak (repo tanpa hash, AC-6.53).
  grep -q 'scrypt\$[0-9]' "$INFRA_DIR_UNDER_TEST/server/dashboard.env" && _fail "dashboard.env repo memuat hash"
  true
}

test_m6_deploy_admin_dry_run_creates_pass() {
  export INFRA_DRY_RUN=1 PXE_RUN=m6core
  local pf="$PXE_AGENT_DIR/keys/m6core-admin.pass"
  run_infra deploy-dashboard.sh
  assert_eq "$RC" 0 "$OUT"
  assert_file "$pf"
  assert_eq "$(stat -c %a "$pf")" 600
  assert_eq "$(wc -c < "$pf")" 24
  local pw; pw="$(cat "$pf")"
  assert_match "$pw" '^[A-Za-z0-9]{24}$'
  assert_not_contains "$OUT" "$pw"
  assert_not_contains "$(cat "$FAKE_LOG")" "$pw"
  assert_match "$(unq "$OUT")" "DRY-RUN: npm --prefix .*/dashboard run --silent admin:hash"
  assert_match "$(unq "$OUT")" "DRY-RUN: ssh .* pxe@10\.99\.0\.2 umask 077 && cat > '/tmp/pxe-test-deploy\..*/admin\.env'"
  # Password lain per pemanggilan admin_pass_new (per run).
  bash -c 'source "$1/lib.sh"; admin_pass_new "$2"' _ "$INFRA_DIR_UNDER_TEST" "$pf"
  assert_ne "$(cat "$pf")" "$pw"
  # File password di luar .agent/keys ditolak.
  set +e; bash -c 'source "$1/lib.sh"; admin_pass_new "$2"' _ "$INFRA_DIR_UNDER_TEST" "$SB/x.pass" 2>/dev/null; RC=$?; set -e
  assert_ne "$RC" 0; assert_no_file "$SB/x.pass"
}

test_m6_kvm_run_pass_removed_and_scanned() {
  # kvm-run (dry-run): password dibuat 0600 saat deploy, tidak tercetak di kvm-run.txt/keluaran,
  # dan dihapus di finish. Password yang bocor ke bukti -> run FAIL.
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1
  run_infra kvm-run.sh m6 --scenario core
  assert_eq "$RC" 0 "$(tail -20 <<<"$OUT")"
  assert_match "$(cat "$PXE_RUNS_DIR/core/kvm-run.txt")" "admin-pass +ok m6core-admin\.pass \(0600"
  assert_match "$(cat "$PXE_RUNS_DIR/core/kvm-run.txt")" "admin-pass +ok password admin tidak ada di bukti"
  assert_no_file "$PXE_AGENT_DIR/keys/m6core-admin.pass"
  # Kebocoran: playwright (dry-run gagal di tahap verify) — tulis password ke bukti lewat hook
  # tahap: simulasi dengan menyalin file password ke bukti sebelum finish tidak mungkin dari luar,
  # jadi uji fungsi scan secara langsung (grep -F -f, tanpa argv).
  local pf="$PXE_AGENT_DIR/keys/m6x-admin.pass" d="$SB/ev"
  mkdir -p "$d"; (umask 077; printf '%s' "$M6_PASS" > "$pf"); echo "log ... $M6_PASS ..." > "$d/a.txt"
  assert_eq "$(grep -rlF -f "$pf" "$d")" "$d/a.txt"
  # finish: scan memakai pola dari process substitution (printf builtin), bukan argv grep.
  assert_contains "$(sed -n '/^finish()/,/^}/p' "$INFRA_DIR_UNDER_TEST/kvm-run.sh")" "grep -rlF -f <(printf '%s\\n' \"\$pw_scan\") \"\$RUNS_DIR\""
}

test_m6_verify_node_token_scan() {
  local r="$SB/root" tok="AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"
  mkdir -p "$r/proc" "$r/etc/default" "$r/boot/grub" "$r/boot/loader/entries" "$r/etc/kernel" "$r/root"
  echo "BOOT_IMAGE=/vmlinuz root=/dev/vda2 ro console=ttyS0" > "$r/proc/cmdline"
  echo 'GRUB_CMDLINE_LINUX="console=ttyS0"' > "$r/etc/default/grub"
  echo "linux /vmlinuz root=/dev/vda2" > "$r/boot/grub/grub.cfg"
  set +e; OUT="$(VERIFY_ONLY=token-scan VERIFY_SCAN_ROOT="$r" bash "$INFRA_DIR_UNDER_TEST/verify-node.sh" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$OUT"
  assert_match "$OUT" "# token-scan files=3 matches=0"
  # Token di grub.cfg target (SR-4-6) dan di BLS entry + anaconda-ks.cfg (Rocky).
  echo "linux /vmlinuz url=http://10.99.0.2/boot/52:54:00:99:00:23/$tok/preseed.cfg" >> "$r/boot/grub/grub.cfg"
  echo "options inst.ks=http://10.99.0.2/boot/52%3A54%3A00%3A99%3A00%3A24/$tok/ks.cfg" > "$r/boot/loader/entries/x.conf"
  echo "url --url=http://10.99.0.2/boot/525400990024/$tok/ks.cfg" > "$r/root/anaconda-ks.cfg"
  mkdir -p "$r/etc/pxe-callback"
  set +e; OUT="$(VERIFY_ONLY=token-scan VERIFY_SCAN_ROOT="$r" bash "$INFRA_DIR_UNDER_TEST/verify-node.sh" 2>&1)"; RC=$?; set -e
  assert_ne "$RC" 0
  assert_match "$OUT" "FAIL bebas token: /boot/grub/grub.cfg \(cocok: 1\)"
  assert_match "$OUT" "FAIL bebas token: /boot/loader/entries/x.conf \(cocok: 1\)"
  assert_match "$OUT" "FAIL bebas token: /root/anaconda-ks.cfg \(cocok: 1\)"
  assert_match "$OUT" "FAIL /etc/pxe-callback tidak ada"
  assert_match "$OUT" "# token-scan files=5 matches=3"
  assert_not_contains "$OUT" "$tok" "token tercetak"
  # Bagian ini juga dipanggil di verifikasi penuh.
  assert_match "$(grep -v '^\s*#' "$INFRA_DIR_UNDER_TEST/verify-node.sh")" "^token_scan$"
}

# ---- CR-5-10 ---------------------------------------------------------------------------------
test_m6_results_json_escaping() {
  local r="$SB/res/results.json"; mkdir -p "$SB/res"
  local nasty=$'a & b "q" \\ back\nnewline \t tab </x> $6$ & \\1'
  python3 -I "$INFRA_DIR_UNDER_TEST/results-json.py" add-entry "$r" m6core ac=X status=PASS "note=$nasty" 'n:=3'
  assert_eq "$(_m6_json "$r" 'd["results"][0]["note"]')" "$nasty"
  assert_eq "$(_m6_json "$r" 'd["results"][0]["n"]')" 3
  assert_eq "$(_m6_json "$r" 'd["run"]')" m6core
  # results.json rusak -> dipindah, bukan ditimpa diam-diam.
  echo '{"results": [ {"ac": ' > "$r"
  python3 -I "$INFRA_DIR_UNDER_TEST/results-json.py" add-entry "$r" m6core ac=Y status=FAIL 2>/dev/null
  assert_eq "$(_m6_json "$r" 'd["results"][0]["ac"]')" Y
  assert_eq "$(ls "$SB/res" | grep -c 'results.json.invalid-')" 1
  assert_match "$(_m6_json "$r" 'd["harnessNotes"][0]')" "tidak valid"
  # Entri yang ada dipertahankan (format Playwright ber-indentasi).
  printf '{\n  "run": "m6core",\n  "session": "s1",\n  "results": [\n    {\n      "ac": "AC-6.44",\n      "status": "PASS"\n    }\n  ]\n}\n' > "$r"
  python3 -I "$INFRA_DIR_UNDER_TEST/results-json.py" add-entry "$r" m6core ac=cleanup status=PASS
  assert_eq "$(_m6_json "$r" '[e["ac"] for e in d["results"]]')" "['AC-6.44', 'cleanup']"
  assert_eq "$(_m6_json "$r" 'd["session"]')" s1
  # Tanpa sed di assert-server-logs (CR-5-10).
  assert_no_match "$(grep -v '^\s*#' "$INFRA_DIR_UNDER_TEST/assert-server-logs.sh")" "\bsed\b"
}

test_m6_assert_server_logs_json_and_files() {
  local d="$SB/runs-kvm"; mkdir -p "$d"
  {
    echo 'Nov  5 16:49:01 dnsmasq-dhcp[1]: DHCPACK(pxe0) 10.99.0.150 52:54:00:99:00:23'
    echo 'Nov  5 16:49:02 dnsmasq-tftp[1]: sent /srv/pxe/tftp/snponly.efi to 10.99.0.150'
  } > "$d/server-dnsmasq.txt"
  {
    echo '10.99.0.150 [t] "GET /boot/52:54:00:99:00:23/***/preseed.cfg" 200 10 "d-i"'
    echo '10.99.0.151 [t] "GET /boot/52:54:00:99:00:24/***/ks.cfg" 200 10 "anaconda"'
    echo '10.99.0.151 [t] "GET /boot/52:54:00:99:00:24/***/user-data" 200 10 "x"'
  } > "$d/server-nginx.txt"
  echo '{"run": "m6distro", "results": [{"ac": "AC-6.48", "status": "PASS"}]}' > "$d/results.json"
  PXE_RESULTS_RUN=m6distro run_infra assert-server-logs.sh "$d" \
    pxe-test-m6distro-node23=52:54:00:99:00:23=uefi=1=preseed.cfg pxe-test-m6distro-node24=52:54:00:99:00:24=bios=2=ks.cfg
  assert_eq "$RC" 1 "$OUT"   # node24 ks.cfg hanya 1x (min 2) -> FAIL
  assert_file "$d/server-log-asserts.json"
  assert_eq "$(_m6_json "$d/server-log-asserts.json" '[(e["ac"], e["node"][-6:], e["status"]) for e in d]')" \
    "[('CR-4-12-dnsmasq', 'node23', 'PASS'), ('CR-4-12-nginx', 'node23', 'PASS'), ('CR-4-12-nginx', 'node24', 'FAIL')]"
  assert_eq "$(_m6_json "$d/results.json" '[e["ac"] for e in d["results"]]')" "['AC-6.48', 'CR-4-12-dnsmasq', 'CR-4-12-nginx', 'CR-4-12-nginx']"
  assert_eq "$(_m6_json "$d/results.json" 'd["results"][2]["note"]')" "preseed.cfg 200 x1 (min 1)"
  assert_eq "$(_m6_json "$d/results.json" 'd["results"][1]["evidence"]')" "['server-dnsmasq.txt']"
  assert_no_file "$d/.server-log-asserts.tsv"
  run_infra assert-server-logs.sh "$d" pxe-test-m6distro-node23=52:54:00:99:00:23=uefi=1=../../etc/passwd
  assert_eq "$RC" 2
}

# ---- O5 nginx + redaksi scrypt ------------------------------------------------------------------
test_m6_nginx_limit_req_static() {
  local conf; conf="$(sed -e 's/#.*$//' "$INFRA_DIR_UNDER_TEST/server/nginx-pxe.conf")"
  assert_match "$conf" 'limit_req_zone \$pxe_login_key zone=pxe_login:1m rate=10r/m;'
  assert_match "$conf" 'limit_req_zone \$binary_remote_addr zone=pxe_boot:2m rate=20r/s;'
  assert_match "$conf" '"~\^/api/auth/login/\?\$" \$binary_remote_addr;'
  assert_match "$conf" 'limit_req_status 429;'
  local boot root
  boot="$(_ngx_block /boot/)"; root="$(_ngx_block /)"
  assert_match "$boot" 'limit_req zone=pxe_boot burst=100 nodelay;'
  assert_match "$root" 'limit_req zone=pxe_login burst=5 nodelay;'
  # Allowlist DEC-015 tetap pada lokasi admin; /boot/ tetap tanpa allow/deny.
  assert_match "$root" 'allow 10\.99\.0\.1;'; assert_match "$root" 'deny all;'
  assert_no_match "$boot" '\b(allow|deny)\b'
  # Kunci login dari $uri (ternormalisasi nginx), bukan $request_uri.
  assert_match "$conf" 'map \$uri \$pxe_login_key'
}

test_m6_redact_scrypt() {
  local d="$SB/ev"; mkdir -p "$d"
  printf 'PXE_ADMIN_PASSWORD_HASH=%s\nok\n' "$M6_HASH" > "$d/journal.txt"
  printf '%s' "PXE_ADMIN_PASSWORD_HASH='$M6_HASH'" | base64 -w0 > "$d/b64.txt"; echo >> "$d/b64.txt"
  run_infra redact-evidence.sh "$d"
  assert_eq "$RC" 0 "$OUT"
  assert_not_contains "$(cat "$d/journal.txt" "$d/b64.txt")" 'scrypt$15'
  assert_contains "$(cat "$d/journal.txt")" 'scrypt$REDACTED'
  assert_contains "$(cat "$d/b64.txt")" 'REDACTED-B64-SECRET'
}

test_m6_install_dashboard_overlay_static() {
  local s; s="$(cat "$INFRA_DIR_UNDER_TEST/server/install-dashboard.sh")"
  assert_no_match "$(grep -v '^\s*#' <<<"$s")" "set -x|set -o xtrace"
  assert_contains "$s" "trap 'rm -f \"\$STAGE/admin.env\"' EXIT"
  assert_contains "$s" "@PXE_ADMIN_PASSWORD_HASH@"
  assert_match "$s" "chown root:pxe"
  assert_match "$s" "chmod 0640"
  # Tidak ada echo/cat isi overlay ke stdout (hanya ke file env sementara).
  assert_no_match "$(grep -v '^\s*#' <<<"$s")" '(echo|printf).*\$(val|v)\b'
}

test_m6_install_dashboard_overlay_merge() {
  # Jalankan bagian merge env install-dashboard.sh di sandbox (path /etc diganti), tanpa root.
  local st="$SB/stage" etc="$SB/etc"
  mkdir -p "$st" "$etc"
  cp "$INFRA_DIR_UNDER_TEST/server/dashboard.env" "$st/dashboard.env"
  printf "PXE_ADMIN_USERNAME=pxeadmin\nPXE_ADMIN_PASSWORD_HASH='%s'\nPXE_JOB_BOOTING_TIMEOUT_MIN=120\n" "$M6_HASH" > "$st/admin.env"
  local body
  body="$(sed -n '/^# --- env + admin (overlay) ---$/,/^echo "OK   \/etc\/pxe-dashboard.env/p' "$INFRA_DIR_UNDER_TEST/server/install-dashboard.sh" \
    | sed -e "s#/etc/#$etc/#g" -e 's/^chown .*$/:/; s/chown root:pxe "\$envtmp"/:/; s/stat -c .%a %U:%G./stat -c %a/')"
  [[ -n "$body" ]] || _fail "blok overlay tidak ditemukan"
  set +e; OUT="$(STAGE="$st" bash -c "set -euo pipefail; $body" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$OUT"
  local env; env="$(cat "$etc/pxe-dashboard.env")"
  assert_eq "$(grep -c '^PXE_ADMIN_PASSWORD_HASH=' <<<"$env")" 1
  assert_contains "$env" "PXE_ADMIN_PASSWORD_HASH='$M6_HASH'"
  assert_eq "$(grep -c '^PXE_JOB_BOOTING_TIMEOUT_MIN=' <<<"$env")" 1
  assert_contains "$env" "PXE_JOB_BOOTING_TIMEOUT_MIN=120"
  assert_not_contains "$env" "@PXE_ADMIN_PASSWORD_HASH@"
  assert_eq "$(stat -c %a "$etc/pxe-dashboard.env")" 640
  assert_no_file "$st/admin.env"
  assert_not_contains "$OUT" "$M6_HASH"
  # Kunci di luar daftar / hash tidak valid -> gagal tanpa mencetak nilai.
  printf "PXE_ADMIN_USERNAME=pxeadmin\nPXE_ADMIN_PASSWORD_HASH='%s'\nPXE_SEED=demo\n" "$M6_HASH" > "$st/admin.env"
  set +e; OUT="$(STAGE="$st" bash -c "set -euo pipefail; $body" 2>&1)"; RC=$?; set -e
  assert_ne "$RC" 0; assert_not_contains "$OUT" "$M6_HASH"
  printf "PXE_ADMIN_USERNAME=pxeadmin\nPXE_ADMIN_PASSWORD_HASH=%s\n" "$M6_HASH" > "$st/admin.env"
  set +e; OUT="$(STAGE="$st" bash -c "set -euo pipefail; $body" 2>&1)"; RC=$?; set -e
  assert_ne "$RC" 0 "hash tanpa kutip tunggal diterima"; assert_not_contains "$OUT" "$M6_HASH"
}

t "M6 kvm-run: entri cleanup di results.json pada gagal tiap tahap + sukses (AC-6.40)" test_m6_cleanup_entry_every_stage
t "M6 kvm-run: resource terlindungi berubah -> cleanup FAIL (AC-6.40)" test_m6_cleanup_entry_protected_changed_fails
t "M6 kvm-run --waves max_nodes 1/2/3, tanpa --waves ditolak (AC-6.41)"   test_m6_waves
t "M6 kvm-run --scenario core/distro/bulk + spec :failpath/:os= (AC-6.41)" test_m6_scenarios_and_specs
t "M6 virsh_m menolak nama terlindungi sebelum virsh"                     test_m6_virsh_guard_protected
t "M6 deploy admin: password/hash hanya via stdin, tanpa bocor (AC-6.42)" test_m6_deploy_admin_no_leak
t "M6 deploy admin dry-run: password 0600 24 karakter (AC-6.42)"         test_m6_deploy_admin_dry_run_creates_pass
t "M6 kvm-run: password admin dihapus + discan di bukti (AC-6.42)"       test_m6_kvm_run_pass_removed_and_scanned
t "M6 verify-node: target bebas token, hanya jumlah (AC-6.42)"           test_m6_verify_node_token_scan
t "M6 results-json.py: escape benar, rusak dipindah (CR-5-10)"           test_m6_results_json_escaping
t "M6 assert-server-logs: JSON terpisah + file per OS (CR-5-10)"         test_m6_assert_server_logs_json_and_files
t "M6 nginx limit_req login + /boot/, allowlist tetap (O5)"              test_m6_nginx_limit_req_static
t "M6 redact-evidence: hash scrypt teks & base64 (AC-6.52)"              test_m6_redact_scrypt
t "M6 install-dashboard overlay: statis"                                  test_m6_install_dashboard_overlay_static
t "M6 install-dashboard overlay: merge env di sandbox"                    test_m6_install_dashboard_overlay_merge

# ---- Perbaikan smoke M6 (BUG-M6-1, BUG-M6-2, verifikasi parsial) ------------------------------
test_m6_bug1_rocky_minimal_repo() {
  # ISO Rocky 9 minimal hanya punya repo Minimal/ (.treeinfo repository = Minimal).
  local l; l="$(grep -E '^\s*rocky\) media_paths\+=' "$INFRA_DIR_UNDER_TEST/kvm-run.sh")"
  [[ -n "$l" ]] || _fail "baris media rocky tidak ditemukan"
  assert_contains "$l" "rocky-9/Minimal/repodata/repomd.xml"
  assert_contains "$l" "rocky-9/.treeinfo"
  assert_contains "$l" "rocky-9/images/pxeboot/vmlinuz"
  assert_no_match "$l" "BaseOS|AppStream"
}

test_m6_bug2_not_run_entries_before_nodes() {
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1
  PXE_KVM_DRY_FAIL_AT=server-check run_infra kvm-run.sh m6 --nodes "41:uefi:os=debian 42:bios:os=rocky"
  assert_ne "$RC" 0
  local r="$PXE_RUNS_DIR/results.json"
  assert_eq "$(_m6_json "$r" 'sorted((e["ac"], e["node"][-6:], e["status"]) for e in d["results"] if e["ac"].startswith("CR-4-12"))')" \
    "[('CR-4-12-dnsmasq', 'node41', 'NOT_RUN'), ('CR-4-12-nginx', 'node41', 'NOT_RUN'), ('CR-4-12-nginx', 'node42', 'NOT_RUN')]"
  assert_eq "$(_m6_json "$r" '[e for e in d["results"] if e["ac"].startswith("CR-4-12")][0]["note"]')" \
    "node tidak dibuat: run berhenti di tahap server-check"
  assert_eq "$(_m6_json "$r" '[e["status"] for e in d["results"] if e["ac"]=="verify-node"]')" "['NOT_RUN', 'NOT_RUN']"
  assert_eq "$(_m6_json "$r" 'len([e for e in d["results"] if e["status"]=="FAIL"])')" 0 "entri FAIL menyesatkan"
  assert_eq "$(_m6_json "$r" '[e["ac"] for e in d["results"]].count("cleanup")')" 1
  assert_match "$(cat "$PXE_RUNS_DIR/kvm-run.txt")" "server-logs +NOT_RUN node belum dibuat \(tahap server-check\)"
  # Setelah node dibuat (gagal di playwright via tahap): tidak ada entri NOT_RUN CR-4-12 dari harness.
  rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
  PXE_KVM_DRY_FAIL_AT=playwright run_infra kvm-run.sh m6 --nodes "41:uefi"
  assert_ne "$RC" 0
  assert_eq "$(_m6_json "$PXE_RUNS_DIR/results.json" 'len([e for e in d["results"] if e["ac"].startswith("CR-4-12")])')" 0
}

test_m6_partial_verify_after_playwright_fail() {
  _prepare_kvm_run_sandbox
  export INFRA_DRY_RUN=1
  # Playwright exit 1: node21 failed, node22 done -> hanya node22 diverifikasi, exit≠0.
  PXE_KVM_DRY_PLAYWRIGHT_RC=1 PXE_KVM_DRY_HOST_STATUS="52:54:00:99:00:21=failed 52:54:00:99:00:22=done" \
    run_infra kvm-run.sh m6 --scenario core
  assert_eq "$RC" 1 "$(tail -5 <<<"$OUT")"
  OUT="$(unq "$OUT")"
  assert_match "$OUT" "DRY-RUN: ssh .* m6admin@10\.99\.0\.32 EXPECT_HOSTNAME=m6-node22 "
  assert_no_match "$OUT" "DRY-RUN: ssh .* m6admin@10\.99\.0\.31 "
  local r="$PXE_RUNS_DIR/core/results.json"
  assert_eq "$(_m6_json "$r" '[(e["node"][-6:], e["status"]) for e in d["results"] if e["ac"]=="verify-node"]')" \
    "[('node21', 'NOT_RUN'), ('node22', 'DRY-RUN')]"
  assert_match "$(_m6_json "$r" '[e for e in d["results"] if e["ac"]=="verify-node"][0]["note"]')" "Playwright exit=1, status host failed"
  assert_eq "$(_m6_json "$r" 'd["harness"]["exit"]')" 1
  assert_eq "$(_m6_json "$r" 'd["harness"]["failedStage"]')" verify
  assert_match "$(cat "$PXE_RUNS_DIR/core/kvm-run.txt")" "verify +partial Playwright exit=1"
  assert_eq "$(_m6_json "$PXE_RUNS_DIR/results.json" 'd["runs"]["core"]["status"]')" FAIL
  # Status tidak terbaca -> tidak ada node diverifikasi, tetap exit≠0 (kode Playwright).
  PXE_KVM_DRY_PLAYWRIGHT_RC=3 run_infra kvm-run.sh m6 --scenario core
  assert_eq "$RC" 3
  assert_no_match "$(unq "$OUT")" "DRY-RUN: ssh .* m6admin@10\.99\.0\.3[12] "
  # Playwright sukses -> semua node diverifikasi (perilaku lama), exit 0.
  run_infra kvm-run.sh m6 --scenario core
  assert_eq "$RC" 0
  assert_match "$(unq "$OUT")" "DRY-RUN: ssh .* m6admin@10\.99\.0\.31 "
  assert_eq "$(_m6_json "$PXE_RUNS_DIR/core/results.json" '[e["status"] for e in d["results"] if e["ac"]=="verify-node"]')" "['DRY-RUN', 'DRY-RUN']"
  assert_eq "$(_m6_json "$PXE_RUNS_DIR/results.json" 'd["runs"]["core"]["status"]')" PASS
  # Gelombang (max_nodes 1): node26 belum done -> verifikasi hanya 25 & 27, tanpa start node26.
  rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
  PXE_KVM_DRY_PLAYWRIGHT_RC=1 PXE_KVM_DRY_HOST_STATUS="52:54:00:99:00:25=done 52:54:00:99:00:26=installing 52:54:00:99:00:27=done" \
    PXE_KVM_MEMINFO="$(_m6_meminfo "$(_m6_mem_for 1)")" run_infra kvm-run.sh m6 --scenario bulk --waves
  assert_eq "$RC" 1
  OUT="$(unq "$OUT")"
  local vpart; vpart="$(sed -nE '/verify +partial/,$p' <<<"$OUT")"
  assert_match "$vpart" "node\.sh start pxe-test-m6bulk-node25 "
  assert_match "$vpart" "node\.sh start pxe-test-m6bulk-node27 "
  assert_no_match "$vpart" "node\.sh start pxe-test-m6bulk-node26"
  assert_eq "$(_m6_json "$PXE_RUNS_DIR/bulk/results.json" '[(e["node"][-6:], e["status"]) for e in d["results"] if e["ac"]=="verify-node"]')" \
    "[('node25', 'DRY-RUN'), ('node26', 'NOT_RUN'), ('node27', 'DRY-RUN')]"
}

t "M6 BUG-M6-1 server-check Rocky memakai repo Minimal/"                   test_m6_bug1_rocky_minimal_repo
t "M6 BUG-M6-2 gagal sebelum node -> CR-4-12 NOT_RUN, bukan FAIL"          test_m6_bug2_not_run_entries_before_nodes
t "M6 verifikasi parsial setelah Playwright gagal (node done saja)"         test_m6_partial_verify_after_playwright_fail
