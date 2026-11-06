# shellcheck shell=bash
# infra/test/m7-te.sh — M7-T9 (test-engineer): pelengkap test shell infra M7 di atas m7-infra.sh
# (backend-dev). Di-source oleh run.sh setelah m7-infra.sh (memakai helper _m7_* dari file itu).
# Tidak pernah menyentuh libvirt/ssh/curl asli (harness: fake-bin + safe-bin, sandbox per test).
#   AC-7.14 nama terlindungi ditolak lib.sh assert_name (dipakai net-up/net-down/cleanup)
#   AC-7.16 nginx VLAN: allowlist hanya di `location /` + SSE; /boot/ & /media/ tanpa allow/deny;
#           rpcbind/nfsd hanya 10.99.10.2; verify-listen-vlan: rpcbind/nfsd di 10.99.0.2 → FAIL + stop
#   AC-7.17 relay key lewat stdin (umask 077 + chmod 600), tanpa scp key; teardown di finish untuk
#           kegagalan setiap tahap setelah relay-setup; statis infra/server/*.sh bagian host
#   AC-7.18 verify-node tanpa EXPECT_VLAN = jalur M6 (tanpa `ip -d -o link`, tanpa baris VLAN);
#           EXPECT_VLAN tidak valid → exit 99; nama anak bebas (ens3.20 / vlan20)
#   AC-7.19 entri `cleanup` di results.json untuk kegagalan di SETIAP tahap (vlancore + vlanneg);
#           cleanup.sh --switch dry-run merencanakan destroy/undefine + hapus disk tanpa mutasi;
#           skenario flat (core) tanpa artefak VLAN
#   AC-7.31 infra/README.md §Topologi VLAN + tanpa hash/secret nyata baru di diff M7

# ---- AC-7.14 ---------------------------------------------------------------------------------
test_m7te_assert_name_protected() {
  local n out rc
  for n in default int pxe-test-node01 ubuntu24.04 virbr-pxe trunk evil-pxe-test-trunk "pxe-test-x;rm"; do
    set +e
    out="$(bash -c 'source "$1/lib.sh"; assert_name "$2"' _ "$INFRA_DIR_UNDER_TEST" "$n" 2>&1)"; rc=$?
    set -e
    assert_ne "$rc" 0 "assert_name '$n' harus ditolak"
  done
  for n in pxe-test pxe-test-nat pxe-test-trunk pxe-test-port1 pxe-test-port2 pxe-test-switch; do
    set +e
    out="$(bash -c 'source "$1/lib.sh"; assert_name "$2"' _ "$INFRA_DIR_UNDER_TEST" "$n" 2>&1)"; rc=$?
    set -e
    assert_eq "$rc" 0 "assert_name '$n' sah: $out"
  done
  # Setiap network VLAN yang dihapus net-down melewati assert_name (urutan: assert lalu virsh).
  assert_match "$(cat "$INFRA_DIR_UNDER_TEST/net-down.sh")" '^  assert_name "\$net"$'
}

test_m7te_net_down_vlan_fake_state() {
  # virsh palsu ber-state: net-up vlan lalu net-down vlan → kelima network hilang; default/int utuh.
  _prepare_kvm_run_sandbox
  run_infra net-up.sh --topology vlan
  assert_eq "$RC" 0 "$OUT"
  run_infra net-down.sh --topology vlan
  assert_eq "$RC" 0 "$OUT"
  local n
  for n in pxe-test pxe-test-nat pxe-test-trunk pxe-test-port1 pxe-test-port2; do assert_no_file "$FAKE_STATE/net/$n"; done
  assert_file "$FAKE_STATE/net/default"; assert_file "$FAKE_STATE/net/int"
  assert_no_match "$(grep -E '^virsh .*net-(destroy|undefine)' "$FAKE_LOG")" "net-(destroy|undefine) (default|int)$"
}

# ---- AC-7.16 ---------------------------------------------------------------------------------
# _m7te_loc <file> <pola-location>: isi blok `location <pola> {` … `}` (tanpa komentar).
_m7te_loc() {
  awk -v pat="$2" '
    /^\s*#/ { next }
    !inb && index($0, "location " pat " {") { inb = 1; depth = 0 }
    inb { print; depth += gsub(/\{/, "{"); depth -= gsub(/\}/, "}"); if (depth == 0) exit }
  ' "$1"
}
test_m7te_nginx_vlan_acl() {
  local n="$INFRA_DIR_UNDER_TEST/server/vlan/nginx-pxe-vlan.conf" b
  for loc in "/media/" "/boot/"; do
    b="$(_m7te_loc "$n" "$loc")"
    assert_contains "$b" "location $loc {" "blok $loc ada"
    assert_no_match "$b" '^\s*(allow|deny)\b' "$loc tanpa allow/deny (node VLAN 10 butuh akses)"
  done
  for loc in "/" '~ ^/api/jobs/[A-Za-z0-9_-]+/logs$'; do
    b="$(_m7te_loc "$n" "$loc")"
    assert_contains "$b" "location $loc {" "blok $loc ada"
    assert_match "$b" '^\s*allow 10\.99\.0\.1; # PXE_ADMIN_ALLOW$' "$loc allowlist admin"
    assert_match "$b" '^\s*deny all;$' "$loc deny all"
    assert_eq "$(grep -cE '^\s*allow ' <<<"$b")" 1 "$loc tepat satu allow"
  done
  # Tidak ada allow untuk subnet VLAN node (10.99.10/20) di mana pun.
  assert_no_match "$(grep -vE '^\s*#' "$n")" 'allow 10\.99\.(10|20)\.'
  # rpcbind/nfsd hanya 10.99.10.2.
  local a; a="$(grep -vE '^\s*#' "$INFRA_DIR_UNDER_TEST/server/vlan/apply-profile.sh")"
  assert_match "$a" "OPTIONS=\"-w -h 10\.99\.10\.2\"' > /etc/default/rpcbind"
  assert_no_match "$(grep -vE '^\s*#' "$INFRA_DIR_UNDER_TEST/server/vlan/nfs-vlan.conf")" '^host=(10\.99\.0\.|10\.99\.20\.|0\.0\.0\.0)'
}

test_m7te_verify_listen_more_fail_cases() {
  _m7_listen_fakes
  local S="$INFRA_DIR_UNDER_TEST/server/vlan/verify-listen-vlan.sh" bad
  for bad in 'tcp LISTEN 0 64 0.0.0.0:2049 0.0.0.0:*' \
             'udp UNCONN 0 0 10.99.0.2:69 0.0.0.0:* users:(("dnsmasq",pid=1,fd=9))' \
             'udp UNCONN 0 0 0.0.0.0%nat0:67 0.0.0.0:* users:(("dnsmasq",pid=1,fd=9))' \
             'udp UNCONN 0 0 0.0.0.0%mgmt20:67 0.0.0.0:* users:(("dnsmasq",pid=1,fd=9))' \
             'tcp LISTEN 0 32 10.99.0.2:53 0.0.0.0:* users:(("dnsmasq",pid=1,fd=9))'; do
    { _m7_ss_good; echo "$bad"; } > "$SB/ss"
    : > "$FAKE_LOG"
    set +e; OUT="$(bash "$S" 2>&1)"; RC=$?; set -e
    assert_eq "$RC" 1 "harus FAIL: $bad"
    assert_contains "$OUT" "RESULT: FAIL"
    assert_match "$(cat "$FAKE_LOG")" "^systemctl stop dnsmasq$" "dnsmasq dihentikan ($bad)"
  done
  # dnsmasq tidak aktif (systemctl) → FAIL.
  _m7_ss_good > "$SB/ss"
  _m7_fake systemctl '[[ "$1" == is-active && "$2" == dnsmasq ]] && { echo inactive; exit 3; }; [[ "$1" == is-active ]] && echo active; exit 0'
  : > "$FAKE_LOG"
  set +e; OUT="$(bash "$S" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 1 "dnsmasq tidak aktif harus FAIL"
  assert_contains "$OUT" "FAIL dnsmasq tidak aktif"
  _m7_fake systemctl '[[ "$1" == is-active ]] && echo active; exit 0'
  # nginx tidak listen 10.99.10.2:80 → FAIL.
  _m7_ss_good | grep -v '10.99.10.2:80 ' > "$SB/ss"
  set +e; OUT="$(bash "$S" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 1 "tanpa nginx 10.99.10.2:80 harus FAIL"
}

# ---- AC-7.17 ---------------------------------------------------------------------------------
test_m7te_relay_key_via_stdin() {
  _m7_vlan_sandbox
  export INFRA_DRY_RUN=1
  run_infra kvm-run.sh m7 --scenario vlancore
  assert_eq "$RC" 0 "$(tail -5 <<<"$OUT")"
  local o; o="$(unq "$OUT")"
  assert_match "$o" "root@10\.99\.0\.2 umask 077 && cat > /root/pxe-relay/node_ed25519 && chmod 600 /root/pxe-relay/node_ed25519$"
  assert_match "$o" "root@10\.99\.0\.2 umask 077 && cat > /root/pxe-relay/verify-node\.sh$"
  # Key node tidak pernah lewat scp / argv.
  assert_no_match "$(grep -E '^DRY-RUN: scp ' <<<"$o" || true)" "node_ed25519|pxe-relay"
  assert_no_match "$o" "pxe-relay/node_ed25519 [^&]*BEGIN"
  # setup sebelum key, status sesudah key, teardown di akhir (sebelum server dimatikan).
  local l_setup l_key l_status l_td
  l_setup="$(grep -n 'MODE=setup bash -s' <<<"$o" | head -1 | cut -d: -f1)"
  l_key="$(grep -n 'cat > /root/pxe-relay/node_ed25519' <<<"$o" | head -1 | cut -d: -f1)"
  l_status="$(grep -n 'MODE=status bash -s' <<<"$o" | head -1 | cut -d: -f1)"
  l_td="$(grep -n 'MODE=teardown bash -s' <<<"$o" | head -1 | cut -d: -f1)"
  [[ -n "$l_setup" && -n "$l_key" && -n "$l_status" && -n "$l_td" ]] || _fail "langkah relay hilang ($l_setup/$l_key/$l_status/$l_td)"
  ((l_setup < l_key && l_key < l_status && l_status < l_td)) || _fail "urutan relay setup($l_setup) < key($l_key) < status($l_status) < teardown($l_td)"
}

test_m7te_host_static_server_scripts() {
  # Bagian HOST dari infra/server/*.sh: hanya script yang dijalankan di host (deploy/provision lewat
  # ssh ke 10.99.0.2) tidak boleh ssh/scp/curl ke 10.99.10/20. Script yang berjalan DI DALAM VM server
  # (provision-root.sh, install-*.sh, verify-listen*.sh, vlan/*) boleh menyebut alamat VLAN lokal.
  local f hits=""
  for f in "$INFRA_DIR_UNDER_TEST"/server/*.sh "$INFRA_DIR_UNDER_TEST"/switch/*.sh; do
    hits+="$(grep -nE '\b(ssh|scp)\b[^#]*@10\.99\.(10|20)\.' "$f" | grep -vE '^[0-9]+:\s*#' | sed "s#^#$f:#" || true)"
  done
  assert_empty "$hits" "ssh/scp ke 10.99.10/20 dari script server/switch"
  # Host-side scripts di infra/ (top-level) + dashboard/e2e-kvm: tidak ada `page.goto`/`baseURL` ke VLAN.
  hits=""
  for f in "$REPO_UNDER_TEST"/dashboard/e2e-kvm/*.ts "$REPO_UNDER_TEST"/dashboard/playwright*.ts; do
    [[ -f "$f" ]] || continue
    hits+="$(grep -nE '(baseURL|goto\(|PXE_KVM_BASE_URL)[^\n]*10\.99\.(10|20)\.' "$f" | grep -vE '^[0-9]+:\s*(//|\*)' | sed "s#^#$f:#" || true)"
  done
  assert_empty "$hits" "UI/API Playwright menyasar 10.99.10/20"
  # Relay hanya dipanggil lewat ssh root@10.99.0.2 (tidak pernah dijalankan lokal di host).
  assert_no_match "$(grep -vE '^\s*#' "$INFRA_DIR_UNDER_TEST/kvm-run.sh")" '^\s*(bash|sh) +"?\$?\{?INFRA_DIR\}?/vlan/relay\.sh'
}

# ---- AC-7.18 ---------------------------------------------------------------------------------
_m7te_vn() { # _m7te_vn [VAR=nilai ...]: verify-node.sh dengan env EXPECT_* node31 (+ tambahan) → OUT/RC
  set +e
  OUT="$(env EXPECT_HOSTNAME=m7-node31 EXPECT_IP=10.99.20.41 EXPECT_PREFIX=24 EXPECT_MAC=52:54:00:99:00:31 \
    EXPECT_GW=10.99.20.1 EXPECT_DNS=10.99.10.2 EXPECT_USER=nobody "EXPECT_PUBKEY=ssh-ed25519 AAAA x" "VERIFY_SCAN_ROOT=$SB/scan" \
    "$@" bash "$REPO_UNDER_TEST/dashboard/e2e-kvm/verify-node.sh" 2>&1)"
  RC=$?
  set -e
}
test_m7te_verify_node_no_vlan_is_m6() {
  _m7_vn_fakes; mkdir -p "$SB/scan"
  _m7_links 20 enp1s0; echo "4: mgmt.20    inet 10.99.20.41/24 brd 10.99.20.255 scope global mgmt.20" > "$SB/addrs"
  : > "$FAKE_LOG"
  _m7te_vn
  # Jalur M6: cari NIC dari /sys/class/net (bukan `ip -d -o link`), tanpa baris VLAN/parent.
  assert_contains "$OUT" "NIC dengan MAC 52:54:00:99:00:31"
  assert_not_contains "$OUT" "anak VLAN"
  assert_not_contains "$OUT" "parent "
  assert_not_contains "$OUT" "# info ip -d -o link"
  assert_no_match "$(cat "$FAKE_LOG")" "^ip -d -o link show"
  # EXPECT_VLAN kosong = tanpa EXPECT_VLAN.
  local o1="$OUT"
  _m7te_vn EXPECT_VLAN=
  assert_eq "$(grep -E '^(OK|FAIL) ' <<<"$OUT" | sed 's/ (aktual.*//')" "$(grep -E '^(OK|FAIL) ' <<<"$o1" | sed 's/ (aktual.*//')"
}

test_m7te_verify_node_vlan_invalid_and_names() {
  _m7_vn_fakes; mkdir -p "$SB/scan"
  local v
  for v in abc 20x "20;id" 12345 -1; do
    _m7te_vn "EXPECT_VLAN=$v"
    assert_eq "$RC" 99 "EXPECT_VLAN '$v'"
    assert_contains "$OUT" "FAIL env EXPECT_VLAN tidak valid"
  done
  # Nama anak bebas (diambil dari `vlan protocol 802.1Q id`, bukan nama): vlan20@ens3.
  printf '%s\n' '2: ens3: <BROADCAST,UP> mtu 1500 \    link/ether 52:54:00:99:00:31 brd ff:ff:ff:ff:ff:ff' \
    '5: vlan20@ens3: <BROADCAST,UP> mtu 1500 \    link/ether 52:54:00:99:00:31 brd ff:ff:ff:ff:ff:ff \    vlan protocol 802.1Q id 20 <REORDER_HDR>' > "$SB/links"
  echo "5: vlan20    inet 10.99.20.41/24 brd 10.99.20.255 scope global vlan20" > "$SB/addrs"
  _m7te_vn EXPECT_VLAN=20
  assert_contains "$OUT" "OK   parent NIC dengan MAC 52:54:00:99:00:31 (bukan VLAN) ditemukan (ens3)"
  assert_contains "$OUT" "OK   anak VLAN 802.1Q id 20 di ens3 ditemukan (vlan20)"
  assert_contains "$OUT" "OK   ip -4 addr vlan20 memuat 10.99.20.41/24"
  # Prefix salah di anak → FAIL.
  echo "5: vlan20    inet 10.99.20.41/16 brd 10.99.255.255 scope global vlan20" > "$SB/addrs"
  _m7te_vn EXPECT_VLAN=20
  assert_ne "$RC" 0; assert_contains "$OUT" "FAIL ip -4 addr vlan20 memuat 10.99.20.41/24"
  # IPv4 di interface lain (NIC kedua) → FAIL.
  printf '%s\n' "5: vlan20    inet 10.99.20.41/24 brd 10.99.20.255 scope global vlan20" "3: enp2s0    inet 10.99.10.177/24 brd 10.99.10.255 scope global enp2s0" > "$SB/addrs"
  _m7te_vn EXPECT_VLAN=20
  assert_ne "$RC" 0; assert_contains "$OUT" "FAIL tidak ada IPv4 di interface lain selain vlan20"
}

# ---- AC-7.19 ---------------------------------------------------------------------------------
test_m7te_kvm_run_cleanup_every_stage() {
  _m7_vlan_sandbox
  export INFRA_DRY_RUN=1
  local st r s
  for s in vlancore vlanneg; do
    for st in preflight net-up server-up deploy switch-up server-check relay-setup nodes discover playwright verify; do
      [[ "$s" == vlanneg && "$st" =~ ^(playwright|verify)$ ]] && continue
      rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
      PXE_KVM_DRY_FAIL_AT="$st" run_infra kvm-run.sh m7 --scenario "$s"
      r="$PXE_RUNS_DIR/$s/results.json"
      if [[ "$RC" == 0 ]]; then
        # Tahap tidak dilalui skenario ini (mis. discover di vlanneg) → run lulus; tetap ada cleanup.
        assert_eq "$(_m7_json "$r" 'len([e for e in d["results"] if e["ac"]=="cleanup"])')" 1 "$s/$st"
        continue
      fi
      assert_file "$r"
      assert_eq "$(_m7_json "$r" 'len([e for e in d["results"] if e["ac"]=="cleanup"])')" 1 "$s gagal di $st: entri cleanup"
      assert_eq "$(_m7_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["failedStage"]')" "$st" "$s/$st failedStage"
      assert_eq "$(_m7_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["relayClean"]')" True "$s/$st relayClean"
      assert_match "$(_m7_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0].keys()')" "switchStopped" "$s/$st switchStopped"
      # Switch dimatikan + di-undefine (cleanup.sh --switch) bila run sudah melewati awal switch-up.
      case "$st" in
        preflight|net-up|server-up|deploy|switch-up) assert_no_match "$(unq "$OUT")" "pxe-test-switch dimatikan" "$s/$st switch belum dibuat" ;;
        *) assert_match "$(unq "$OUT")" "pxe-test-switch dimatikan dan di-undefine" "$s/$st switch dimatikan" ;;
      esac
      assert_empty "$(mutating_calls)" "$s/$st dry-run tanpa mutasi"
      assert_no_file "$PXE_AGENT_DIR/keys/m7$s-admin.pass"
    done
  done
}

test_m7te_cleanup_switch_dry() {
  _prepare_kvm_run_sandbox
  echo running > "$FAKE_STATE/dom/pxe-test-switch"
  : > "$PXE_AGENT_DIR/vms/pxe-test-switch.qcow2"; : > "$PXE_AGENT_DIR/vms/pxe-test-switch-seed.iso"
  : > "$PXE_AGENT_DIR/vms/pxe-test-switch-base.qcow2"
  export INFRA_DRY_RUN=1
  : > "$FAKE_LOG"
  run_infra cleanup.sh m7vlancore --switch
  assert_eq "$RC" 0 "$OUT"
  local o; o="$(unq "$OUT")"
  assert_match "$o" "DRY-RUN: virsh -c qemu:///system destroy pxe-test-switch$"
  assert_match "$o" "DRY-RUN: virsh -c qemu:///system undefine( --nvram)? pxe-test-switch$"
  assert_match "$o" "DRY-RUN: rm -f .*/vms/pxe-test-switch\.qcow2"
  assert_match "$o" "DRY-RUN: rm -f .*/vms/pxe-test-switch-seed\.iso"
  assert_no_match "$o" "pxe-test-switch-base\.qcow2" "base dipertahankan tanpa --base"
  assert_no_match "$o" "(destroy|undefine)( --nvram)? (pxe-test-node01|ubuntu24\.04|default|int)$"
  assert_empty "$(mutating_calls)" "dry-run tanpa mutasi"
  assert_file "$FAKE_STATE/dom/pxe-test-switch"; assert_file "$PXE_AGENT_DIR/vms/pxe-test-switch.qcow2"
  # --base: base switch ikut direncanakan.
  run_infra cleanup.sh m7vlancore --switch --base
  assert_eq "$RC" 0 "$OUT"
  assert_match "$(unq "$OUT")" "DRY-RUN: rm -f .*/vms/pxe-test-switch-base\.qcow2"
}

test_m7te_flat_scenario_no_vlan_artifacts() {
  _m7_vlan_sandbox
  export INFRA_DRY_RUN=1
  local s o
  for s in core distro bulk; do
    rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
    run_infra kvm-run.sh m7 --scenario "$s"
    assert_eq "$RC" 0 "$s: $(tail -5 <<<"$OUT")"
    o="$(unq "$OUT")"
    assert_no_match "$o" "pxe-test-(trunk|port1|port2|switch)|relay\.sh|MODE=(setup|teardown)|--topology vlan|PXE_KVM_TOPOLOGY=vlan|10\.99\.(10|20)\." "$s flat tanpa artefak VLAN"
    assert_match "$o" "virt-install .*--network network=pxe-test,mac=52:54:00:99:00:" "$s node di pxe-test"
    assert_no_match "$(cat "$PXE_RUNS_DIR/$s/kvm-run.txt")" "^[0-9TZ:-]+ (switch-up|relay-setup|relay-teardown) " "$s tanpa tahap switch/relay"
  done
}

# ---- AC-7.31 ---------------------------------------------------------------------------------
test_m7te_readme_vlan_section() {
  local r; r="$(awk '/^## Topologi VLAN/{f=1; print; next} f && /^## /{exit} f' "$INFRA_DIR_UNDER_TEST/README.md")"
  assert_contains "$r" "## Topologi VLAN"
  local n
  for n in pxe-test pxe-test-nat pxe-test-trunk pxe-test-port1 pxe-test-port2; do assert_match "$r" "^\| \`$n\` \|"; done
  assert_match "$r" "^\| 10 PXE \| \`10\.99\.10\.0/24\`"
  assert_match "$r" "^\| 20 management \| \`10\.99\.20\.0/24\`"
  assert_contains "$r" "Alur paket"
  assert_contains "$r" "Syarat jaringan production (O5"
  assert_match "$r" "PXE_SERVER_IP.*terjangkau dari VLAN management"
  assert_contains "$r" "NFS"
  for n in vlansmoke vlanneg vlancore vlandistro; do assert_match "$r" "infra/kvm-run\.sh m7 --scenario $n"; done
  assert_match "$r" "infra/net-down\.sh --topology vlan"
  assert_match "$r" "infra/cleanup\.sh m7 --server --switch"
  # .env.example: kosong + contoh berkomentar.
  local e; e="$(cat "$REPO_UNDER_TEST/dashboard/.env.example")"
  assert_match "$e" "^# PXE_VLAN_NETWORKS=[0-9]+:"
  assert_no_match "$e" "^PXE_VLAN_NETWORKS=."
}

test_m7te_no_new_secrets_in_m7_diff() {
  # Baris tambahan di diff milestone (main...HEAD) tanpa hash admin / hash password / private key.
  command -v git >/dev/null || _fail "git tidak tersedia"
  git -C "$REPO_UNDER_TEST" rev-parse --verify -q main >/dev/null || return 0
  local added
  added="$(git -C "$REPO_UNDER_TEST" diff main...HEAD -- . ':(exclude).agent/runs' ':(exclude)infra/test' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' | grep -E '^\+' | grep -vE '^\+\+\+ ' || true)"
  assert_no_match "$added" 'scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/]{16,}' "hash scrypt nyata"
  assert_no_match "$added" '-----BEGIN [A-Z ]*PRIVATE KEY-----' "private key"
  # Hash fixture uji (salt `fixturesalt`, dibangun di kode test) dikecualikan; selain itu gagal.
  assert_no_match "$(grep -v 'fixturesalt' <<<"$added" || true)" '\$6\$[A-Za-z0-9./]{8,16}\$[A-Za-z0-9./]{86}' "hash sha512crypt"
}

# DEC-027 §4 (M7-T11): kredensial di query string mirip URL di bukti = temuan (scan saja, exit 1),
# termasuk server-nginx.txt dan server-nginx-error.txt; nilai tersamar/kosong dan /login?*** lolos.
# Test ini merah bila pola URL_CRED_RE / blok urlhits dihapus dari redact-evidence.sh.
test_m7te_redact_url_credentials() {
  local d="$SB/evidence-url" pw="Xq9-run-secret-ZZ"
  mkdir -p "$d"
  echo "10.99.0.1 [2026-11-06T14:58:54+00:00] \"GET /login?username=pxeadmin&password=$pw\" 200 10817 \"Mozilla\"" > "$d/server-nginx.txt"
  echo "2026/11/06 14:58:54 [error] 1#1: *5 open() failed, request: \"GET /x?password=$pw HTTP/1.1\"" > "$d/server-nginx-error.txt"
  {
    echo "10.99.0.1 [2026-11-06T15:00:00+00:00] \"GET /login?***\" 200 1 \"curl\""
    echo "GET /login?username=<REDACTED>&password=<REDACTED-admin-password>"
    echo "GET /login?password= 200"
    echo "# bukan GET /login?username=…&password=… (komentar kode); pola \`?password=\`"
    echo "d-i passwd/user-password-crypted password \$6\$REDACTED"
  } > "$d/ok.txt"
  run_infra redact-evidence.sh "$d"
  assert_eq "$RC" 1 "$OUT"
  assert_contains "$OUT" "TEMUAN"
  assert_match "$OUT" "server-nginx\.txt:1"
  assert_match "$OUT" "server-nginx-error\.txt:1"
  assert_not_contains "$OUT" "ok.txt" "nilai tersamar/kosong/*** ikut dilaporkan"
  assert_not_contains "$OUT" "$pw" "isi kredensial bocor ke output"
  # Hanya scan: file tidak diubah (kebocoran tetap terlihat untuk diperbaiki di sumbernya).
  assert_contains "$(cat "$d/server-nginx.txt")" "password=$pw"
  # username= sendiri juga temuan.
  rm -f "$d/server-nginx.txt" "$d/server-nginx-error.txt"
  echo "GET /login?next=%2Fhosts&username=pxeadmin" > "$d/server-nginx.txt"
  run_infra redact-evidence.sh "$d"
  assert_eq "$RC" 1 "$OUT"
  assert_match "$OUT" "server-nginx\.txt:1"
  # Bersih → exit 0.
  rm -f "$d/server-nginx.txt"
  run_infra redact-evidence.sh "$d"
  assert_eq "$RC" 0 "$OUT"
}

t "M7te assert_name menolak nama terlindungi/tanpa prefix (AC-7.14)"            test_m7te_assert_name_protected
t "M7te net-up/net-down vlan (palsu): lima network hilang, default/int utuh (AC-7.14)" test_m7te_net_down_vlan_fake_state
t "M7te nginx VLAN: ACL hanya / + SSE, /boot & /media terbuka; rpcbind 10.99.10.2 (AC-7.16)" test_m7te_nginx_vlan_acl
t "M7te verify-listen-vlan: kasus FAIL tambahan + stop dnsmasq (AC-7.16)"       test_m7te_verify_listen_more_fail_cases
t "M7te relay key via stdin 0600, urutan setup→key→status→teardown (AC-7.17)"   test_m7te_relay_key_via_stdin
t "M7te statis: script server/switch & Playwright tidak menyasar VLAN (AC-7.17)" test_m7te_host_static_server_scripts
t "M7te verify-node tanpa EXPECT_VLAN = jalur M6 (AC-7.18)"                     test_m7te_verify_node_no_vlan_is_m6
t "M7te verify-node EXPECT_VLAN invalid → 99; nama anak bebas; prefix/IP lain FAIL (AC-7.18)" test_m7te_verify_node_vlan_invalid_and_names
t "M7te kvm-run gagal di SETIAP tahap → entri cleanup (vlancore+vlanneg) (AC-7.19)" test_m7te_kvm_run_cleanup_every_stage
t "M7te cleanup.sh --switch dry-run: rencana destroy/undefine + disk (AC-7.19)"  test_m7te_cleanup_switch_dry
t "M7te skenario flat core/distro/bulk tanpa artefak VLAN (AC-7.19)"            test_m7te_flat_scenario_no_vlan_artifacts
t "M7te README §Topologi VLAN + .env.example (AC-7.31)"                         test_m7te_readme_vlan_section
t "M7te diff M7 tanpa hash/private key nyata (AC-7.31)"                         test_m7te_no_new_secrets_in_m7_diff
t "M7te redact-evidence: password=/username= di URL (nginx access+error) → exit 1 (DEC-027 §4)" test_m7te_redact_url_credentials
