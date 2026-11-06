#!/usr/bin/env bash
# infra/kvm-run.sh <m> [--scenario core|distro|bulk|vlansmoke|vlanneg|vlancore|vlandistro] [--nodes "<spec> ..."] [--waves]
#                      [--booting-timeout-min N] [--keep-server] [--skip-build]
# Orkestrasi suite KVM satu milestone (M4-T7/T13, M5-T7, M6-T7):
#   libvirt-before -> preflight -> net-up -> server-up -> password admin per run + deploy-dashboard
#   -> server-check -> key sekali pakai -> node pxe-test-<run>-nodeNN (bergelombang bila --waves)
#   -> Playwright dashboard/e2e-kvm -> verifikasi SSH per node (dashboard/e2e-kvm/verify-node.sh)
#   -> bukti -> asersi log server -> cleanup -> libvirt-after/diff -> entri `cleanup` di
#   results.json -> redaksi + scan -> ringkasan. Semua setelah "bukti" berjalan SELALU (trap EXIT),
#   juga untuk run parsial/gagal di tahap mana pun.
#
# Run id & bukti:
#   tanpa --scenario : run id <m>,          bukti .agent/runs/<m>/kvm/
#   --scenario <s>   : run id <m><s> (mis. m6core), bukti .agent/runs/<m>/kvm/<s>/, ringkasan
#                      gabungan .agent/runs/<m>/kvm/results.json (DEC-018 §4, O12)
#   (PXE_RUNS_DIR menggantikan .agent/runs/<m>/kvm sebagai basis.)
# Node default: tanpa skenario "11:uefi 12:bios"; core "21:uefi:failpath 22:bios:destroy";
#   distro "23:uefi:os=debian 24:uefi:os=rocky"; bulk "25:uefi 26:uefi 27:uefi".
# Spec node: NN:uefi|bios[:destroy|:failpath][:os=ubuntu|debian|rocky] (NN 10-89, 1-3 node).
#   Node NN: MAC 52:54:00:99:00:NN, IP 10.99.0.(10+NN), user ${PXE_KVM_NODE_USER:-<m>admin},
#   hostname <m>-nodeNN (bulk: <m>-bulk-<urutan 01..> sesuai urutan --nodes = template
#   `<m>-bulk-{index:02}`).
#   :destroy  (M5) suite mematikan paksa node di tengah install (PXE_KVM_POWER_CMD)
#   :failpath (M6) suite menjalankan job gagal dulu (disk /dev/vdz) lalu install ulang
# VM paralel = clamp((MemAvailable - RAM server bila belum jalan - 4 GB) / 2 GB, 1, 3)
#   (MemAvailable dari ${PXE_KVM_MEMINFO:-/proc/meminfo}). Node > max_nodes:
#   tanpa --waves -> gagal (dry-run hanya bila PXE_KVM_MEMINFO diset; selain itu peringatan);
#   --waves      -> node dibagi gelombang berukuran max_nodes: discover per gelombang (create ->
#                   tunggu GET /boot/<mac>.ipxe di log nginx -> poweroff), lalu suite menyalakan
#                   gelombang berikutnya setelah gelombang sebelumnya Done (PXE_KVM_WAVES), dan
#                   verifikasi SSH juga per gelombang. Gelombang > 1 -> PXE_JOB_BOOTING_TIMEOUT_MIN
#                   dinaikkan ke 120 (kecuali --booting-timeout-min), dicatat di results.json.
# --keep-server : cleanup tanpa --server (VM pxe-test-server dibiarkan menyala untuk debug).
# --skip-build  : deploy memakai build standalone yang sudah ada (SKIP_BUILD=1).
# INFRA_DRY_RUN=1 didukung (rencana dicetak; PXE_KVM_DRY_FAIL_AT=<tahap> mensimulasikan kegagalan
# tahap itu — hanya di dry-run, untuk test harness; PXE_KVM_DRY_VERIFY_EXEC=1 menjalankan jalur
# verifikasi SSH non-dry terhadap ssh palsu di PATH test, BUG-M6-10).
#
# Admin dashboard per run (DEC-017 §3): password acak di .agent/keys/<run>-admin.pass (0600),
# hash via `npm run admin:hash` (stdin) di deploy-dashboard.sh. Suite hanya menerima PATH file
# (PXE_KVM_ADMIN_PASS_FILE). File password, cookie jar, dan key node dihapus saat selesai.
#
# Kontrak env untuk suite Playwright dashboard/e2e-kvm:
#   PXE_KVM_BASE_URL     http://10.99.0.2
#   PXE_KVM_RUN          run id (<m> atau <m><scenario>);  PXE_KVM_RUNS_DIR  dir bukti absolut
#   PXE_KVM_SCENARIO     core|distro|bulk|"" ;  PXE_KVM_SPEC  <m> → dashboard/e2e-kvm/<m>-*.spec.ts
#   PXE_KVM_NODES        "<name>=<mac>=<fw>=<ip>=<os>=<role>=<hostname> ..." (dipisah spasi;
#                        4 field pertama = kontrak M4)
#   PXE_KVM_NODE_USER    username yang harus diset di dashboard
#   PXE_KVM_SSH_PUBKEY / PXE_KVM_SSH_KEY  key ed25519 sekali pakai (.agent/keys)
#   PXE_KVM_RESET_CMD / PXE_KVM_POWER_CMD  path infra/node.sh (reset|poweroff|start <name>)
#   PXE_KVM_GATEWAY / PXE_KVM_DNS / PXE_KVM_PREFIX   10.99.0.1 / 10.99.0.2 / 24
#   PXE_KVM_DESTROY_NODES / PXE_KVM_FAILPATH_NODES  nama node per peran (dipisah spasi)
#   PXE_KVM_ADMIN_USER   username admin;  PXE_KVM_ADMIN_PASS_FILE  path file password (0600)
#   PXE_KVM_MAX_NODES    max_nodes;  PXE_KVM_WAVES  "a,b c" (gelombang dipisah spasi, node koma;
#                        kosong = tanpa gelombang; node gelombang sudah dimatikan setelah discover)
#   PXE_KVM_BOOTING_TIMEOUT_MIN  nilai PXE_JOB_BOOTING_TIMEOUT_MIN di server (kosong = default env)
#
# M7 — topologi VLAN (DEC-023/024, docs/design/M7-plan.md §2.6–2.7). Skenario vlan* menyiratkan
# --topology vlan:
#   vlansmoke  run id <m>vlansmoke  bukti .agent/runs/<m>/kvm/smoke/   node "41:uefi 42:uefi:os=rocky 43:uefi:os=debian"
#   vlanneg    run id <m>vlanneg    bukti .agent/runs/<m>/kvm/vlanneg/  node "36:uefi:neg=admin 37:bios:neg=access20 38:uefi:neg=tagged10"
#   vlancore   run id <m>vlancore   bukti .agent/runs/<m>/kvm/vlancore/ node "31:uefi 32:bios"
#   vlandistro run id <m>vlandistro bukti .agent/runs/<m>/kvm/vlandistro/ node "33:uefi:os=debian 34:uefi:os=rocky"
#   Spec node + `:neg=admin|access20|tagged10` (HANYA dan WAJIB di vlanneg). IP node VLAN =
#   10.99.20.(10+NN); network node: neg=admin -> pxe-test, access20|tagged10 -> pxe-test-port2,
#   lainnya -> pxe-test-port1.
#   Urutan: libvirt-before -> preflight (+ `ip route get 10.99.10.2` baca saja) -> net-up --topology
#   vlan -> server-up --topology vlan (profil + verify-listen-vlan) -> deploy --topology vlan ->
#   switch-up (+ switch-check) -> server-check (verify-listen-vlan) -> key sekali pakai -> relay setup
#   (key node + verify-node.sh lewat STDIN ssh ke root@10.99.0.2:/root/pxe-relay, 0600) -> node
#   (+ capture DHCP trunk0) / alur negatif vlanneg -> Playwright -> verifikasi lewat relay -> bukti ->
#   relay teardown (`relay-clean: absent`, SEBELUM server dimatikan) -> cleanup (node, --switch,
#   --server) -> libvirt-after/diff -> redaksi + scan. Host hanya ssh/curl ke 10.99.0.2/10.99.0.3.
#   max_nodes = clamp((MemAvailable - 3072 bila server belum jalan - 768 bila switch belum jalan
#   - 4096) / 2048, 1, 3); vlanneg selalu satu node pada satu waktu.
#   Env suite tambahan: PXE_KVM_TOPOLOGY=vlan PXE_KVM_VLAN=20 PXE_KVM_INFRA_KEY PXE_KVM_RELAY_CMD
#   (gateway/DNS node 10.99.20.1/10.99.10.2). Env harness: PXE_KVM_NEG_WAIT_SEC (default 240).
set -euo pipefail

usage() {
  echo "pakai: $0 <m> [--scenario core|distro|bulk|vlansmoke|vlanneg|vlancore|vlandistro] [--nodes \"NN:uefi|bios[:destroy|:failpath][:os=ubuntu|debian|rocky][:neg=admin|access20|tagged10] ...\"] [--waves] [--booting-timeout-min N] [--keep-server] [--skip-build]" >&2
  exit 2
}
[[ $# -ge 1 ]] || usage
m="$1"; shift
[[ "$m" =~ ^m[0-9]+$ ]] || { echo "milestone '$m' harus berbentuk m<angka>" >&2; exit 2; }
nodes_spec=""; keep_server=0; scenario=""; waves_mode=0; booting_min=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --nodes) [[ $# -ge 2 ]] || usage; nodes_spec="$2"; shift 2 ;;
    --scenario) [[ $# -ge 2 ]] || usage; scenario="$2"; shift 2 ;;
    --waves) waves_mode=1; shift ;;
    --booting-timeout-min) [[ $# -ge 2 ]] || usage; booting_min="$2"; shift 2 ;;
    --keep-server) keep_server=1; shift ;;
    --skip-build) export SKIP_BUILD=1; shift ;;
    *) usage ;;
  esac
done
case "$scenario" in
  "") run_id="$m"; : "${nodes_spec:=11:uefi 12:bios}" ;;
  core) run_id="${m}core"; : "${nodes_spec:=21:uefi:failpath 22:bios:destroy}" ;;
  distro) run_id="${m}distro"; : "${nodes_spec:=23:uefi:os=debian 24:uefi:os=rocky}" ;;
  bulk) run_id="${m}bulk"; : "${nodes_spec:=25:uefi 26:uefi 27:uefi}" ;;
  vlansmoke) run_id="${m}vlansmoke"; : "${nodes_spec:=41:uefi 42:uefi:os=rocky 43:uefi:os=debian}" ;;
  vlanneg) run_id="${m}vlanneg"; : "${nodes_spec:=36:uefi:neg=admin 37:bios:neg=access20 38:uefi:neg=tagged10}" ;;
  vlancore) run_id="${m}vlancore"; : "${nodes_spec:=31:uefi 32:bios}" ;;
  vlandistro) run_id="${m}vlandistro"; : "${nodes_spec:=33:uefi:os=debian 34:uefi:os=rocky}" ;;
  *) echo "scenario '$scenario' harus core|distro|bulk|vlansmoke|vlanneg|vlancore|vlandistro" >&2; exit 2 ;;
esac
topology=flat; [[ "$scenario" == vlan* ]] && topology=vlan
if [[ "$scenario" == vlanneg ]] && ((waves_mode)); then echo "--waves tidak berlaku untuk vlanneg (selalu satu node)" >&2; exit 2; fi
if [[ -n "$booting_min" ]]; then
  [[ "$booting_min" =~ ^[0-9]{1,4}$ ]] && ((booting_min >= 1 && booting_min <= 1440)) \
    || { echo "--booting-timeout-min '$booting_min' harus 1-1440" >&2; exit 2; }
fi
_repo="$(cd "$(dirname "$0")/.." && pwd)"
KVM_BASE="${PXE_RUNS_DIR:-$_repo/.agent/runs/$m/kvm}"
if [[ -n "$scenario" ]]; then
  # vlansmoke -> bukti .agent/runs/<m>/kvm/smoke/ (M7-T10).
  scen_dir="$scenario"; [[ "$scenario" == vlansmoke ]] && scen_dir=smoke
  export PXE_RUNS_DIR="$KVM_BASE/$scen_dir"; COMBINED="$KVM_BASE/results.json"
else
  export PXE_RUNS_DIR="$KVM_BASE"; COMBINED=""
fi
export PXE_RUN="$run_id"
source "$(dirname "$0")/lib.sh"

E2E_DIR="$DASH_DIR/e2e-kvm"
E2E_CONFIG="$E2E_DIR/playwright.config.ts"
VERIFY_SCRIPT="$E2E_DIR/verify-node.sh"
RELAY_SCRIPT="$INFRA_DIR/vlan/relay.sh"
VLAN_MGMT_ID=20
NODE_USER="${PXE_KVM_NODE_USER:-${m}admin}"
SUMMARY="$RUNS_DIR/kvm-run.txt"
RESULTS="$RUNS_DIR/results.json"
RJ=(python3 -I "$INFRA_DIR/results-json.py")
ts="$(date -u +%Y%m%dT%H%M%SZ)"; t_start="$(date +%s)"; started_at="$(date -u +%FT%TZ)"
RUN_KEY="$KEYS_DIR/pxe-test-$run_id-$ts-node_ed25519"
ADMIN_PASS_FILE="$KEYS_DIR/$run_id-admin.pass"
SESSION_JAR="$KEYS_DIR/pxe-test-$run_id-$ts-session.jar"

step() { # step <nama> <status> [catatan]
  printf '%s %-18s %s %s\n' "$(date -u +%FT%TZ)" "$1" "$2" "${3:-}" | tee -a "$SUMMARY" >&2
}
stage="args"
stage_begin() { # stage_begin <tahap>: tahap aktif (dicatat sebagai failedStage bila gagal).
  stage="$1"
  if is_dry && [[ "${PXE_KVM_DRY_FAIL_AT:-}" == "$1" ]]; then die "simulasi gagal di tahap $1 (PXE_KVM_DRY_FAIL_AT, dry-run)"; fi
}

# --- daftar node (eksplisit, maks 3; tanpa wildcard) ----------------------------------------
declare -a NODE_NAMES=() NODE_MACS=() NODE_FWS=() NODE_IPS=() NODE_ROLES=() NODE_OSES=() NODE_HOSTS=()
declare -a NODE_NEGS=() NODE_NETS=()
NODE_SPEC_RE='^([1-8][0-9]):(uefi|bios)(:(destroy|failpath))?(:os=(ubuntu|debian|rocky))?(:neg=(admin|access20|tagged10))?$'
for spec in $nodes_spec; do
  [[ "$spec" =~ $NODE_SPEC_RE ]] || die "spec node '$spec' harus NN:uefi|bios[:destroy|:failpath][:os=ubuntu|debian|rocky][:neg=admin|access20|tagged10] (NN 10-89)"
  nn="${BASH_REMATCH[1]}"; fw="${BASH_REMATCH[2]}"; role="${BASH_REMATCH[4]}"; os="${BASH_REMATCH[6]:-ubuntu}"
  neg="${BASH_REMATCH[8]}"
  # M7: :neg= hanya (dan wajib) di skenario vlanneg.
  if [[ "$scenario" == vlanneg ]]; then
    [[ -n "$neg" ]] || die "spec node '$spec': skenario vlanneg wajib :neg=admin|access20|tagged10"
    [[ -z "$role" ]] || die "spec node '$spec': :$role tidak berlaku di vlanneg"
  else
    [[ -z "$neg" ]] || die "spec node '$spec': :neg= hanya untuk --scenario vlanneg"
  fi
  name="pxe-test-$run_id-node$nn"
  assert_name "$name"
  for n in "${NODE_NAMES[@]}"; do [[ "$n" == "$name" ]] && die "node $name ganda"; done
  NODE_NAMES+=("$name"); NODE_MACS+=("52:54:00:99:00:$nn"); NODE_FWS+=("$fw")
  if [[ "$topology" == vlan ]]; then
    NODE_IPS+=("10.99.20.$((10#$nn + 10))")
    case "$neg" in
      admin) NODE_NETS+=("$NET_PXE") ;;
      access20|tagged10) NODE_NETS+=("$NET_PORT2") ;;
      *) NODE_NETS+=("$NET_PORT1") ;;
    esac
  else
    NODE_IPS+=("10.99.0.$((10#$nn + 10))"); NODE_NETS+=("$NET_PXE")
  fi
  NODE_NEGS+=("$neg")
  NODE_ROLES+=("${role:-install}"); NODE_OSES+=("$os")
  if [[ "$scenario" == bulk ]]; then NODE_HOSTS+=("$(printf '%s-bulk-%02d' "$m" "${#NODE_NAMES[@]}")")
  else NODE_HOSTS+=("$m-node$nn"); fi
  assert_mac "${NODE_MACS[-1]}"
done
((${#NODE_NAMES[@]} >= 1 && ${#NODE_NAMES[@]} <= 3)) || die "jumlah node harus 1-3"
config_file_for() { case "$1" in debian) echo preseed.cfg ;; rocky) echo ks.cfg ;; *) echo user-data ;; esac; }

ensure_dirs
# Bukti run lama di direktori yang sama tidak boleh tercampur dengan entri run ini.
[[ -f "$RESULTS" ]] && mv -f "$RESULTS" "$RUNS_DIR/results.prev-$ts.json"

# --- snapshot libvirt (baca saja) ---------------------------------------------------------
# libvirt_norm <raw> : baris "dom <name> <state>" / "net <name> <kolom...>" (tanpa kolom Id yang
# berubah tiap start) untuk diff dan cek resource terlindungi.
libvirt_snapshot() { # libvirt_snapshot <file>
  { echo "# $(date -u +%FT%TZ) virsh -c $VIRSH_URI list --all"; virsh_q list --all 2>&1 || true
    echo "# virsh -c $VIRSH_URI net-list --all"; virsh_q net-list --all 2>&1 || true; } > "$1"
}
libvirt_norm() {
  awk '/^# .*net-list/ { sec = "net"; next } /^# .*list --all/ { sec = "dom"; next }
       /^[[:space:]]*$/ || /^[[:space:]]*-{3,}[[:space:]]*$/ || $1 == "Id" || $1 == "Name" { next }
       sec == "dom" && NF >= 3 { st = $3; for (i = 4; i <= NF; i++) st = st " " $i; print "dom " $2 " " st; next }
       sec == "net" && NF >= 2 { l = "net " $1; for (i = 2; i <= NF; i++) l = l " " $i; print l }' "$1" | sort
}
libvirt_snapshot "$RUNS_DIR/libvirt-before.txt"

# --- cleanup selalu (trap EXIT) ------------------------------------------------------------
server_started=0; nodes_created=0; max_nodes=""; avail_mb=""; mem_avail_mb=""
# M7 (vlan): switch dibuat run ini, relay disiapkan, capture DHCP trunk0 aktif, hasil teardown relay.
switch_started=0; relay_started=0; capture_active=""; relay_clean=""
# Hasil verifikasi SSH per node (indeks NODE_NAMES): PASS|FAIL|NOT_RUN|DRY-RUN + catatan.
declare -a VERIFY_STATUS=() VERIFY_NOTE=()
declare -a WAVES=()
collect_evidence() {
  local i name
  for i in "${!NODE_NAMES[@]}"; do
    name="${NODE_NAMES[$i]}"
    if [[ -f "$RUNS_DIR/$name-console.log" ]]; then
      sed -e 's/\x1b\[[0-9;?]*[A-Za-z]//g' -e 's/\r//g' "$RUNS_DIR/$name-console.log" \
        | tr -cd '\11\12\40-\176' > "$RUNS_DIR/$name-console.txt"
    fi
  done
  ((server_started)) || return 0
  is_dry && return 0
  dom_running "$SERVER_NAME" || return 0
  ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'cat /var/log/dnsmasq-pxe.log' > "$RUNS_DIR/server-dnsmasq.txt" 2>&1 || true
  ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'cat /var/log/nginx/pxe-access.log' > "$RUNS_DIR/server-nginx.txt" 2>&1 || true
  ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'cat /var/log/nginx/error.log' > "$RUNS_DIR/server-nginx-error.txt" 2>&1 || true
  ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'journalctl -u pxe-dashboard --no-pager -o short-iso' \
    > "$RUNS_DIR/server-pxe-dashboard-journal.txt" 2>&1 || true
  if [[ "$topology" == vlan ]]; then
    # M7: capture DHCP trunk0 yang masih aktif (run gagal di tengah) -> ringkasan teks dulu.
    if [[ -n "$capture_active" ]]; then
      relay_exec "MODE=capture-stop CAP_IF=$capture_active" > "$RUNS_DIR/capture-$capture_active.txt" 2>&1 || true
      capture_active=""
    fi
    ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'ip -d link show; echo "# ip -br addr"; ip -br addr; echo "# ip route"; ip route; echo "# ip_forward=$(cat /proc/sys/net/ipv4/ip_forward)"; echo "# ss -lunp"; ss -lunp' \
      > "$RUNS_DIR/server-net-final.txt" 2>&1 || true
    if ((switch_started)) && dom_running "$SWITCH_NAME"; then
      ssh "${SSH_OPTS[@]}" "root@$SWITCH_IP" '/usr/local/sbin/pxe-switch.sh verify' > "$RUNS_DIR/switch-check-final.txt" 2>&1 || true
    fi
  fi
  export_job_logs
}
# relay_exec "<ENV=...>": jalankan infra/vlan/relay.sh sebagai root DI VM server (10.99.0.2); keluaran
# relay ke stdout. Host tidak pernah menyasar 10.99.10.*/10.99.20.* (DEC-024 O7-A). Dry-run: dicetak
# (kecuali PXE_KVM_DRY_VERIFY_EXEC=1 -> dijalankan terhadap ssh palsu di PATH test).
relay_exec() {
  if is_dry && [[ "${PXE_KVM_DRY_VERIFY_EXEC:-0}" != 1 ]]; then
    run ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" "$1 bash -s" < "$RELAY_SCRIPT"
    return 0
  fi
  ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" "$1 bash -s" < "$RELAY_SCRIPT"
}
# relay_teardown: hapus key node + pcap di VM server; `relay-clean: absent` dicatat (AC-7.30).
relay_teardown() {
  local o
  ((relay_started)) || { relay_clean=true; return 0; }
  if is_dry; then relay_exec "MODE=teardown"; relay_clean=true; return 0; fi
  if dom_running "$SERVER_NAME" && o="$(relay_exec "MODE=teardown" 2>&1)" && grep -qx 'relay-clean: absent' <<<"$o"; then
    relay_clean=true
  else
    relay_clean=false
  fi
  printf '# %s relay teardown (sebelum server dimatikan)\n%s\n' "$(date -u +%FT%TZ)" "${o:-server tidak berjalan}" > "$RUNS_DIR/relay-teardown.txt"
}
# Ekspor riwayat + log job per node (M5) dari host lewat nginx (allowlist admin = host lab).
# M6: API butuh sesi -> login admin sekali (cookie jar 0600 di .agent/keys, dihapus di finish).
export_job_logs() {
  local i name hid jobs id out auth=()
  [[ -f "$ADMIN_PASS_FILE" ]] && admin_login "$ADMIN_PASS_FILE" "$SESSION_JAR" >/dev/null && auth=(-b "$SESSION_JAR")
  for i in "${!NODE_NAMES[@]}"; do
    name="${NODE_NAMES[$i]}"; hid="${NODE_MACS[$i]//:/}"
    out="$RUNS_DIR/jobs-$name.json"
    jobs="$(curl -fsS --max-time 10 "${auth[@]}" "http://$SERVER_IP/api/jobs?hostId=$hid&limit=200" 2>/dev/null)" || jobs='{"error":"GET /api/jobs gagal"}'
    {
      printf '{"node": "%s", "jobs": %s, "logs": {' "$name" "$jobs"
      local first=1
      for id in $(grep -oE '"id":"job-[0-9a-f-]{36}"' <<<"$jobs" | cut -d'"' -f4 | sort -u); do
        ((first)) || printf ','
        first=0
        printf '"%s": %s' "$id" "$(curl -fsS --max-time 10 "${auth[@]}" "http://$SERVER_IP/api/jobs/$id/logs?format=json" 2>/dev/null || echo '{"error":"log gagal"}')"
      done
      printf '}}\n'
    } > "$out"
  done
}
# CR-4-12: asersi log dnsmasq/nginx (infra/assert-server-logs.sh) → results.json.
assert_server_logs() {
  local i specs=() want
  for i in "${!NODE_NAMES[@]}"; do
    want=1; [[ "${NODE_ROLES[$i]}" == destroy || "${NODE_ROLES[$i]}" == failpath ]] && want=2
    specs+=("${NODE_NAMES[$i]}=${NODE_MACS[$i]}=${NODE_FWS[$i]}=$want=$(config_file_for "${NODE_OSES[$i]}")")
  done
  PXE_RESULTS_RUN="$run_id" "$INFRA_DIR/assert-server-logs.sh" "$RUNS_DIR" "${specs[@]}"
}
json_str() { python3 -I -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
finish() {
  local rc=$? i failed_stage="" cst=PASS cnote="" prot_ok=true remain=0 p b a diff_sum pw_scan=""
  # Playwright gagal tetapi verifikasi parsial selesai: exit = kode Playwright (bila verifikasi lulus).
  ((rc == 0 && ${e2e_rc:-0} != 0)) && rc="$e2e_rc"
  trap - EXIT INT TERM
  set +e
  # Password admin run hanya di memori untuk scan bukti di akhir (cleanup.sh menghapus filenya).
  [[ -s "$ADMIN_PASS_FILE" ]] && pw_scan="$(cat "$ADMIN_PASS_FILE")"
  ((rc == 0)) || failed_stage="$stage"
  step evidence start
  collect_evidence
  step evidence done
  if [[ "$topology" == vlan ]]; then
    relay_teardown
    step relay-teardown "$([[ "$relay_clean" == true ]] && echo ok || echo FAIL)" "relay-clean: $([[ "$relay_clean" == true ]] && echo absent || echo PRESENT)"
  fi
  # BUG-M6-2: asersi log server hanya bermakna bila node sudah dibuat; selain itu entri NOT_RUN
  # (bukan FAIL palsu "tidak ada TFTP …") dengan tahap gagal sebagai alasan.
  if [[ "$scenario" == vlanneg ]]; then
    : # Uji negatif: node sengaja TANPA DHCP/TFTP/iPXE -> asersi CR-4-12 tidak berlaku (lihat AC-7.26–7.28).
  elif ((server_started && nodes_created)) && ! is_dry; then
    if assert_server_logs; then step server-logs ok; else step server-logs FAIL "server-log-asserts.txt"; ((rc != 0)) || rc=1; fi
  elif ((!nodes_created)); then
    for i in "${!NODE_NAMES[@]}"; do
      for p in CR-4-12-dnsmasq CR-4-12-nginx; do
        [[ "$p" == CR-4-12-dnsmasq && "${NODE_FWS[$i]}" != uefi ]] && continue
        "${RJ[@]}" add-entry "$RESULTS" "$run_id" "ac=$p" "node=${NODE_NAMES[$i]}" status=NOT_RUN \
          "note=node tidak dibuat: run berhenti di tahap ${failed_stage:-${stage}}" 'evidence:=["kvm-run.txt"]'
      done
    done
    step server-logs NOT_RUN "node belum dibuat (tahap ${failed_stage:-$stage})"
  fi
  # Hasil verifikasi SSH per node (juga node yang tidak diverifikasi -> NOT_RUN + alasan).
  for i in "${!NODE_NAMES[@]}"; do
    [[ "$scenario" == vlanneg ]] && continue
    "${RJ[@]}" add-entry "$RESULTS" "$run_id" ac=verify-node "node=${NODE_NAMES[$i]}" "status=${VERIFY_STATUS[$i]:-NOT_RUN}" \
      "note=${VERIFY_NOTE[$i]:-tidak diverifikasi: run berhenti di tahap ${failed_stage:-$stage}}" \
      "evidence:=[\"${NODE_NAMES[$i]}-verify.txt\"]"
  done
  # Cleanup terpisah per VM node yang dibuat run ini (nama eksplisit), lalu cleanup.sh untuk sisa
  # milik run (^pxe-test-<run>-) dan server bila tidak --keep-server.
  for i in "${!NODE_NAMES[@]}"; do
    "$INFRA_DIR/node.sh" destroy "${NODE_NAMES[$i]}" "${NODE_MACS[$i]}" >/dev/null 2>&1
  done
  # Server hanya dimatikan bila run ini sudah sampai tahap server (gagal preflight = tidak disentuh).
  local cl_args=("$run_id")
  ((keep_server || !server_started)) || cl_args+=(--server)
  # M7: switch dimatikan bersama server (kecuali --keep-server).
  ((keep_server || !switch_started)) || cl_args+=(--switch)
  "$INFRA_DIR/cleanup.sh" "${cl_args[@]}"
  local crc=$?
  ((crc == 0)) || { cst=FAIL; cnote="cleanup.sh exit=$crc; "; }
  step cleanup "$([[ $crc == 0 ]] && echo done || echo FAIL)" "$(if ((keep_server || !server_started)); then echo '(server tidak dimatikan)'; fi)"
  # Bukti libvirt sesudah + diff; resource terlindungi harus identik, domain run ini harus hilang.
  libvirt_snapshot "$RUNS_DIR/libvirt-after.txt"
  b="$(libvirt_norm "$RUNS_DIR/libvirt-before.txt")"; a="$(libvirt_norm "$RUNS_DIR/libvirt-after.txt")"
  for p in "${PROTECTED_NAMES[@]}"; do
    if [[ "$(grep -E "^(dom|net) ${p//./\\.}( |$)" <<<"$b")" != "$(grep -E "^(dom|net) ${p//./\\.}( |$)" <<<"$a")" ]]; then
      prot_ok=false; cnote+="resource terlindungi $p berubah; "
    fi
  done
  remain="$(grep -cE "^dom pxe-test-$run_id-" <<<"$a")"
  ((remain == 0)) || cnote+="$remain domain pxe-test-$run_id-* tersisa; "
  { echo "# diff libvirt (dinormalisasi: tanpa kolom Id) before -> after"
    diff -u <(echo "$b") <(echo "$a") | tail -n +3
    echo "# protectedIdentical=$prot_ok runDomainsRemaining=$remain"; } > "$RUNS_DIR/libvirt-diff.txt"
  diff_sum="+$(diff <(echo "$b") <(echo "$a") | grep -c '^>') -$(diff <(echo "$b") <(echo "$a") | grep -c '^<')"
  [[ "$prot_ok" == true && "$remain" == 0 ]] || cst=FAIL
  local vlan_fields=() sw_stopped=true
  if [[ "$topology" == vlan ]]; then
    if dom_running "$SWITCH_NAME"; then sw_stopped=false; fi
    ((keep_server)) || [[ "$sw_stopped" == true ]] || { cst=FAIL; cnote+="$SWITCH_NAME masih berjalan; "; }
    [[ "$relay_clean" == true ]] || { cst=FAIL; cnote+="relay di VM server tidak bersih (key node); "; }
    vlan_fields=("topology=vlan" "switchStopped:=$sw_stopped" "relayClean:=${relay_clean:-false}")
  fi
  [[ "$cst" == PASS ]] || { ((rc != 0)) || rc=1; }
  # Key node, cookie jar sesi admin: tidak dipakai lagi setelah run.
  rm -f "$RUN_KEY" "$RUN_KEY.pub" "$SESSION_JAR"
  "${RJ[@]}" add-entry "$RESULTS" "$run_id" ac=cleanup "status=$cst" "note=${cnote:-semua resource run dihapus; resource terlindungi identik}" \
    "failedStage=${failed_stage:-}" "libvirtDiff=$diff_sum (lihat libvirt-diff.txt)" "protectedIdentical:=$prot_ok" \
    "runDomainsRemaining:=$remain" "serverStopped:=$( ((server_started && !keep_server)) && echo true || echo false)" \
    "${vlan_fields[@]}" \
    'evidence:=["libvirt-before.txt","libvirt-after.txt","libvirt-diff.txt","cleanup.txt","kvm-run.txt"]' \
    || { step results FAIL "results.json tidak bisa ditulis"; ((rc != 0)) || rc=1; }
  step libvirt "$cst" "protectedIdentical=$prot_ok remaining=$remain diff=$diff_sum"
  # AC-4.34/AC-6.52: samarkan token job dan hash $6$ di SEMUA bukti, scan ulang (juga scrypt$,
  # private key); masih ada secret -> run gagal. Password admin run dicari literal (pola dari
  # file lewat grep -f, tidak pernah di argv) sebelum file password dihapus.
  if "$INFRA_DIR/redact-evidence.sh" "$RUNS_DIR"; then step redact ok; else step redact FAIL "secret tersisa di bukti $RUNS_DIR"; ((rc != 0)) || rc=1; fi
  if [[ -n "$pw_scan" ]]; then
    local leaked; leaked="$(grep -rlF -f <(printf '%s\n' "$pw_scan") "$RUNS_DIR" 2>/dev/null | head -20)"
    if [[ -n "$leaked" ]]; then step admin-pass FAIL "password admin muncul di: ${leaked//$'\n'/ }"; ((rc != 0)) || rc=1
    else step admin-pass ok "password admin tidak ada di bukti"; fi
  fi
  rm -f "$ADMIN_PASS_FILE"; pw_scan=""
  local waves_json
  waves_json="$(python3 -I -c 'import json,sys; print(json.dumps([w.split(",") for w in sys.argv[1:]]))' "${WAVES[@]}")"
  "${RJ[@]}" set "$RESULTS" "$run_id" harness "$(printf '{"milestone": %s, "scenario": %s, "runId": %s, "nodes": %s, "maxNodes": %s, "memAvailableMb": %s, "wavesMode": %s, "waves": %s, "bootingTimeoutMin": %s, "failedStage": %s, "exit": %s, "dryRun": %s, "startedAt": %s, "durationSec": %s}' \
    "$(json_str "$m")" "$(json_str "$scenario")" "$(json_str "$run_id")" "$(json_str "$nodes_spec")" "${max_nodes:-null}" "${mem_avail_mb:-null}" \
    "$( ((waves_mode)) && echo true || echo false)" "$waves_json" "${booting_min:-null}" "$(json_str "$failed_stage")" "$rc" \
    "$(is_dry && echo true || echo false)" "$(json_str "$started_at")" "$(( $(date +%s) - t_start ))")" \
    || { step results FAIL "harness meta"; ((rc != 0)) || rc=1; }
  if [[ -n "$COMBINED" ]]; then "${RJ[@]}" summary "$COMBINED" "$m" "$scenario" "$RESULTS" || step results FAIL "ringkasan $COMBINED"; fi
  step result "$([[ $rc == 0 ]] && echo PASS || echo FAIL)" "exit=$rc${failed_stage:+ stage=$failed_stage}"
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT TERM

{ echo "# kvm-run $m scenario=${scenario:-—} run=$run_id $ts nodes=[$nodes_spec] waves=$waves_mode keep_server=$keep_server dry=${INFRA_DRY_RUN:-0}"; } > "$SUMMARY"

# --- preflight -----------------------------------------------------------------------------
stage_begin preflight
pre="$RUNS_DIR/kvm-run-preflight.txt"
MEMINFO="${PXE_KVM_MEMINFO:-/proc/meminfo}"
{
  echo "# preflight $(date -u +%FT%TZ)"
  for c in virsh virt-install qemu-img ssh scp ssh-keygen curl socat npm npx tar xz python3; do
    printf '%-13s %s\n' "$c" "$(command -v "$c" || echo MISSING)"
  done
  printf '/dev/kvm      %s\n' "$([[ -c /dev/kvm ]] && echo ok || echo MISSING)"
  printf 'OVMF          %s\n' "$([[ -f $OVMF_CODE && -f $OVMF_VARS ]] && echo ok || echo MISSING)"
  printf 'e2e-kvm       %s\n' "$([[ -f $E2E_CONFIG ]] && echo ok || echo MISSING)"
  printf 'verify-node   %s\n' "$([[ -f $VERIFY_SCRIPT ]] && echo ok || echo MISSING)"
  echo "# meminfo: $MEMINFO"
  grep -E '^(MemTotal|MemAvailable):' "$MEMINFO" || echo "MemAvailable MISSING"
  echo "# virsh list --all"; virsh_q list --all 2>&1 || true
  echo "# virsh net-list --all"; virsh_q net-list --all 2>&1 || true
  if [[ "$topology" == vlan ]]; then
    # M7 (baca saja): host TIDAK punya route ke VLAN 10/20 -> semua akses lewat relay di VM server.
    echo "# ip route get 10.99.10.2 (baca saja; host tidak pernah menyasar 10.99.10.*/10.99.20.*)"
    ip route get 10.99.10.2 2>&1 || echo "(ip tidak tersedia)"
    echo "# /proc/sys/net/bridge/* (baca saja)"
    if compgen -G '/proc/sys/net/bridge/*' >/dev/null; then grep -H . /proc/sys/net/bridge/* 2>/dev/null || true
    else echo "(br_netfilter tidak dimuat)"; fi
  fi
} > "$pre"
missing="$(grep -c 'MISSING' "$pre" || true)"
if ((missing > 0)); then
  if is_dry; then log "preflight: $missing item MISSING (diabaikan di dry-run), lihat $pre"
  else grep MISSING "$pre" >&2; die "preflight gagal (lihat $pre)"; fi
fi
# Batas VM paralel (CLAUDE.md): clamp((RAM bebas - 4 GB) / 2 GB, 1, 3), RAM server dikurangkan
# bila server belum berjalan.
mem_avail_mb=$(( $(awk '/^MemAvailable:/{print $2}' "$MEMINFO") / 1024 ))
avail_mb="$mem_avail_mb"
dom_running "$SERVER_NAME" || avail_mb=$((avail_mb - ${SERVER_RAM_MB:-3072}))
# M7: RAM switch dikurangkan bila switch belum berjalan (RAM VM yang sudah jalan tidak dua kali).
if [[ "$topology" == vlan ]]; then dom_running "$SWITCH_NAME" || avail_mb=$((avail_mb - ${SWITCH_RAM_MB:-768})); fi
max_nodes=$(( (avail_mb - 4096) / 2048 ))
if ((max_nodes < 1)); then max_nodes=1; elif ((max_nodes > 3)); then max_nodes=3; fi
if [[ "$scenario" == vlanneg ]]; then
  : # vlanneg: satu node hidup pada satu waktu (alur berurutan), tidak dibatasi jumlah node total.
elif ((waves_mode)); then
  # Gelombang berukuran max_nodes, urutan sesuai --nodes.
  for ((i = 0; i < ${#NODE_NAMES[@]}; i += max_nodes)); do
    WAVES+=("$(IFS=,; echo "${NODE_NAMES[*]:i:max_nodes}")")
  done
  if ((${#WAVES[@]} > 1)) && [[ -z "$booting_min" ]]; then booting_min=120; fi
elif ((${#NODE_NAMES[@]} > max_nodes)); then
  if ! is_dry || [[ -n "${PXE_KVM_MEMINFO:-}" ]]; then
    die "RAM bebas ${avail_mb} MB hanya cukup untuk $max_nodes node (pakai --waves untuk bergelombang)"
  fi
  log "RAM bebas ${avail_mb} MB hanya cukup untuk $max_nodes node (diabaikan di dry-run)"
fi
# Node milik run ini tidak boleh sudah ada (sisa run gagal -> jalankan cleanup.sh <run>).
for name in "${NODE_NAMES[@]}"; do
  dom_exists "$name" && die "$name sudah ada (sisa run sebelumnya); jalankan infra/cleanup.sh $run_id"
done
step preflight ok "max_nodes=$max_nodes avail_mb=$avail_mb mem_available_mb=$mem_avail_mb waves=${WAVES[*]:-—}"

# --- server + dashboard --------------------------------------------------------------------
# Output net-up (rencana DRY-RUN / status network) ditampilkan di stderr agar terlihat.
stage_begin net-up
if [[ "$topology" == vlan ]]; then "$INFRA_DIR/net-up.sh" --topology vlan >&2; else "$INFRA_DIR/net-up.sh" >&2; fi
step net-up ok
stage_begin server-up
server_started=1
if [[ "$topology" == vlan ]]; then
  "$INFRA_DIR/server-up.sh" --topology vlan; step server-up ok "profil VLAN + server-listen-vlan.txt PASS"
else
  "$INFRA_DIR/server-up.sh"; step server-up ok
fi
stage_begin deploy
admin_pass_new "$ADMIN_PASS_FILE"
step admin-pass ok "$(basename "$ADMIN_PASS_FILE") (0600, isi tidak dicetak)"
deploy_args=(); [[ "$topology" == vlan ]] && deploy_args=(--topology vlan)
PXE_ADMIN_PASS_FILE="$ADMIN_PASS_FILE" PXE_DEPLOY_BOOTING_TIMEOUT_MIN="$booting_min" "$INFRA_DIR/deploy-dashboard.sh" "${deploy_args[@]}"
step deploy ok "admin=$ADMIN_USERNAME booting_timeout_min=${booting_min:-default}"

if [[ "$topology" == vlan ]]; then
  # M7 (O3): switch baru dibuat SETELAH profil VLAN server terverifikasi (server-up di atas).
  stage_begin switch-up
  switch_started=1
  "$INFRA_DIR/switch-up.sh"; step switch-up ok "switch-check.txt"
fi

stage_begin server-check
check="$RUNS_DIR/server-check.txt"
media_paths=(ubuntu-24.04/casper/vmlinuz)
for os in "${NODE_OSES[@]}"; do
  case "$os" in
    debian) media_paths+=(debian-netboot/linux debian-netboot/initrd.gz debian-12/dists/bookworm/Release) ;;
    # BUG-M6-1: ISO Rocky 9 *minimal* (9.8) hanya punya repo `Minimal/` (.treeinfo
    # `repository = Minimal`), tanpa BaseOS/AppStream.
    rocky) media_paths+=(rocky-9/images/pxeboot/vmlinuz rocky-9/images/pxeboot/initrd.img rocky-9/.treeinfo rocky-9/Minimal/repodata/repomd.xml) ;;
  esac
done
listen_script="$INFRA_DIR/server/verify-listen.sh"
[[ "$topology" == vlan ]] && listen_script="$INFRA_DIR/server/vlan/verify-listen-vlan.sh"
if is_dry; then
  ssh_root 'bash -s' < "$listen_script"
else
  {
    rc=0
    ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'bash -s' < "$listen_script" || rc=1
    echo "# services"
    ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" \
      'for s in dnsmasq nginx nfs-server pxe-dashboard; do printf "%-14s %s\n" $s $(systemctl is-active $s); done; echo "# listen :3000"; ss -ltnH "sport = :3000"; echo "# nginx -t"; nginx -t 2>&1' || rc=1
    echo "# host: GET http://$SERVER_IP/login"
    c="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "http://$SERVER_IP/login" 2>/dev/null)" || c=000
    echo "$c"; [[ "$c" == 200 ]] || rc=1
    echo "# host: GET http://$SERVER_IP/api/settings tanpa sesi (harus 401)"
    c="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "http://$SERVER_IP/api/settings" 2>/dev/null)" || c=000
    echo "$c"; [[ "$c" == 401 ]] || rc=1
    for p in $(printf '%s\n' "${media_paths[@]}" | sort -u); do
      echo "# host: HEAD http://$SERVER_IP/media/$p"
      curl -fsSI --max-time 10 -o /dev/null -w '%{http_code}\n' "http://$SERVER_IP/media/$p" || rc=1
    done
    if [[ " ${NODE_OSES[*]} " == *" debian "* ]]; then
      # O11: kernel netboot harus seversi dengan DVD (modul kernel d-i). Info untuk smoke, bukan gate.
      echo "# info: sha256 kernel Debian netboot vs DVD install.amd"
      ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" \
        'sha256sum /srv/pxe/media/debian-netboot/linux /srv/pxe/media/debian-12/install.amd/vmlinuz 2>&1 | sed "s#  # #"' || true
    fi
    echo "# server-check exit=$rc"
  } > "$check" 2>&1
  grep -q '^# server-check exit=0$' "$check" || die "server-check gagal (lihat $check)"
fi
step server-check ok

# --- key sekali pakai + node ----------------------------------------------------------------
# VLAN: key node dibuat di tahap relay-setup (relay butuh key); tahap `nodes` dimulai setelah relay siap.
if [[ "$topology" == vlan ]]; then stage_begin relay-setup; else stage_begin nodes; fi
run ssh-keygen -q -t ed25519 -N '' -C "pxe-test-$run_id-$ts" -f "$RUN_KEY"
node_cmd() { if is_dry; then run "$INFRA_DIR/node.sh" "$@"; else "$INFRA_DIR/node.sh" "$@"; fi; }
idx_of() { local i; for i in "${!NODE_NAMES[@]}"; do [[ "${NODE_NAMES[$i]}" == "$1" ]] && { echo "$i"; return 0; }; done; return 1; }
# wait_discovered <mac> <timeout-s>: dashboard sudah menerima GET /boot/<mac>.ipxe (log nginx).
wait_discovered() {
  local mac="$1" t="$2" i=0 n
  is_dry && return 0
  while ((i < t)); do
    n="$(ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" "grep -cF '\"GET /boot/$mac.ipxe' /var/log/nginx/pxe-access.log" 2>/dev/null || true)"
    [[ "$n" =~ ^[0-9]+$ ]] && ((n > 0)) && return 0
    sleep 10; i=$((i + 10))
  done
  return 1
}
# node_net_args <index>: `--net <network>` untuk topologi vlan (flat: kosong = perilaku M6).
node_net_args() { if [[ "$topology" == vlan ]]; then printf '%s\n' --net "${NODE_NETS[$1]}"; fi; return 0; }

if [[ "$topology" == vlan ]]; then
  # --- relay SSH di VM server (DEC-023 §4, O7-A) -------------------------------------------
  # Key node sekali pakai + verify-node.sh dikirim lewat STDIN ssh ke root@10.99.0.2 (umask 077,
  # chmod 600), tidak pernah lewat argv/scp ke lokasi yang terbaca user lain; dihapus MODE=teardown
  # di finish (juga run gagal di tahap mana pun setelah titik ini).
  relay_started=1
  relay_exec "MODE=setup"
  key_src="$RUN_KEY"; vs_src="$VERIFY_SCRIPT"
  if is_dry; then key_src=/dev/null; vs_src=/dev/null; fi
  ssh_root 'umask 077 && cat > /root/pxe-relay/node_ed25519 && chmod 600 /root/pxe-relay/node_ed25519' < "$key_src"
  ssh_root 'umask 077 && cat > /root/pxe-relay/verify-node.sh' < "$vs_src"
  if is_dry; then relay_exec "MODE=status"
  else relay_exec "MODE=status" > "$RUNS_DIR/relay-setup.txt" 2>&1 || die "relay setup gagal (lihat relay-setup.txt)"; fi
  step relay-setup ok "/root/pxe-relay (key 0600, isi tidak dicetak)"
  stage_begin nodes
fi

# --- M7 vlanneg: uji negatif isolasi, satu node pada satu waktu (§2.7, AC-7.26–7.28) ---------
NEG_WAIT_SEC="${PXE_KVM_NEG_WAIT_SEC:-240}"
[[ "$NEG_WAIT_SEC" =~ ^[0-9]{1,4}$ ]] || die "PXE_KVM_NEG_WAIT_SEC '$NEG_WAIT_SEC' harus angka"
neg_count() { # neg_count <file> <regex-ERE> -> jumlah baris cocok (0 bila file tidak ada)
  local n; n="$(grep -acE -- "$2" "$1" 2>/dev/null)" || true; echo "${n:-0}"
}
neg_rx_packets() { # neg_rx_packets <file ip -s link> -> paket RX
  awk '/RX:/ { getline; print $2; exit }' "$1" 2>/dev/null || true
}
neg_run_one() { # neg_run_one <index>
  local i="$1" name mac neg capif cap swb swa dif t0 note st n_req n_rep n_tag n_from n_dns n_ngx rx_b rx_a tx host_hit ok=1 acid evid
  name="${NODE_NAMES[$i]}"; mac="${NODE_MACS[$i]}"; neg="${NODE_NEGS[$i]}"
  capif=trunk0; [[ "$neg" == admin ]] && capif=pxe0
  case "$neg" in admin) acid=AC-7.26 ;; access20) acid=AC-7.27 ;; tagged10) acid=AC-7.28 ;; esac
  cap="$RUNS_DIR/$name-capture-$capif.txt"; swb="$RUNS_DIR/$name-switch-sw-p2-before.txt"
  swa="$RUNS_DIR/$name-switch-sw-p2-after.txt"; dif="$RUNS_DIR/$name-domifstat.txt"
  t0="$(date +%s)"
  if [[ "$neg" != admin ]]; then
    ssh_switch_root "/usr/local/sbin/pxe-switch.sh apply-port sw-p2 $neg"
    step neg-port ok "$name sw-p2=$neg"
  fi
  if is_dry; then ssh_switch_root 'ip -s link show dev sw-p2'
  else ssh "${SSH_OPTS[@]}" "root@$SWITCH_IP" 'ip -s link show dev sw-p2' > "$swb" 2>&1 || true; fi
  relay_exec "MODE=capture-start CAP_IF=$capif"; capture_active="$capif"
  # shellcheck disable=SC2046
  "$INFRA_DIR/node.sh" create "$name" "$mac" "${NODE_FWS[$i]}" $(node_net_args "$i")
  step node-create ok "$name ${NODE_FWS[$i]} $mac net=${NODE_NETS[$i]} neg=$neg (tunggu ${NEG_WAIT_SEC}s)"
  if is_dry; then echo "DRY-RUN-WAIT: $name neg=$neg: tunggu ${NEG_WAIT_SEC}s (DHCP tidak boleh dijawab)"; else sleep "$NEG_WAIT_SEC"; fi
  if is_dry; then relay_exec "MODE=capture-stop CAP_IF=$capif"
  else relay_exec "MODE=capture-stop CAP_IF=$capif" > "$cap" 2>&1 || true; fi
  capture_active=""
  if is_dry; then
    ssh_switch_root 'ip -s link show dev sw-p2'
  else
    ssh "${SSH_OPTS[@]}" "root@$SWITCH_IP" 'ip -s link show dev sw-p2' > "$swa" 2>&1 || true
    { local ifn; ifn="$(virsh_q domiflist "$name" 2>/dev/null | awk 'NR > 2 && $1 != "" { print $1; exit }')"
      echo "# virsh domifstat $name ${ifn:-?} (baca saja)"
      [[ -n "$ifn" ]] && virsh_q domifstat "$name" "$ifn" 2>&1; } > "$dif" || true
    ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" "grep -aiF '$mac' /var/log/dnsmasq-pxe.log" > "$RUNS_DIR/$name-dnsmasq.txt" 2>/dev/null || true
    ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" "grep -aF '\"GET /boot/$mac.ipxe' /var/log/nginx/pxe-access.log" > "$RUNS_DIR/$name-nginx.txt" 2>/dev/null || true
    host_hit=x
    if admin_login "$ADMIN_PASS_FILE" "$SESSION_JAR" >/dev/null; then
      curl -fsS --max-time 10 -b "$SESSION_JAR" "http://$SERVER_IP/api/hosts" > "$RUNS_DIR/$name-hosts.json" 2>/dev/null || true
      host_hit="$(grep -aciF "$mac" "$RUNS_DIR/$name-hosts.json" 2>/dev/null)" || true
    fi
  fi
  "$INFRA_DIR/node.sh" destroy "$name" "$mac" >/dev/null 2>&1 || true
  if [[ "$neg" == tagged10 ]]; then
    ssh_switch_root '/usr/local/sbin/pxe-switch.sh apply-port sw-p2 access20'
    if is_dry; then ssh_switch_root '/usr/local/sbin/pxe-switch.sh verify'
    else ssh "${SSH_OPTS[@]}" "root@$SWITCH_IP" '/usr/local/sbin/pxe-switch.sh verify' > "$RUNS_DIR/switch-check-after-n3.txt" 2>&1 || true; fi
    step neg-port ok "sw-p2 dikembalikan ke access20 (switch-check-after-n3.txt)"
  fi
  if is_dry; then
    "${RJ[@]}" add-entry "$RESULTS" "$run_id" "ac=$acid" "node=$name" status=DRY-RUN "note=dry-run: neg=$neg tidak dievaluasi" 'evidence:=["kvm-run.txt"]'
    return 0
  fi
  # Evaluasi (bukti teks; pcap mentah tidak dibawa ke host).
  n_req="$(neg_count "$cap" "Request from $mac")"
  n_rep="$(neg_count "$cap" 'BOOTP/DHCP, Reply')"
  n_tag="$(neg_count "$cap" "$mac > .*vlan $VLAN_MGMT_ID,")"
  n_from="$(neg_count "$cap" "$mac > ")"
  n_dns="$(neg_count "$RUNS_DIR/$name-dnsmasq.txt" .)"
  n_ngx="$(neg_count "$RUNS_DIR/$name-nginx.txt" .)"
  rx_b="$(neg_rx_packets "$swb")"; rx_a="$(neg_rx_packets "$swa")"
  tx="$(awk '$2 == "tx_packets" { print $3; exit }' "$dif" 2>/dev/null || true)"
  note="pcap $capif: request dari MAC=$n_req reply=$n_rep tag$VLAN_MGMT_ID=$n_tag frame-dari-MAC=$n_from; dnsmasq=$n_dns nginx-ipxe=$n_ngx api-hosts=${host_hit:-?}; sw-p2 RX ${rx_b:-?}->${rx_a:-?}; domifstat tx=${tx:-?}"
  ((n_rep == 0 && n_dns == 0 && n_ngx == 0)) || ok=0
  [[ "$host_hit" == 0 ]] || ok=0
  case "$neg" in
    admin) ((n_req >= 1)) || ok=0; [[ "${tx:-0}" =~ ^[0-9]+$ ]] && ((${tx:-0} > 0)) || ok=0 ;;
    access20) ((n_tag >= 1)) || ok=0 ;;
    tagged10)
      # Node memang mengirim (TX dari domifstat; RX sw-p2 hanya pelengkap: bridge host juga mengirim
      # multicast IPv6 ke semua port, jadi kenaikan RX saja bukan bukti), tetapi 0 frame di trunk0.
      ((n_from == 0)) || ok=0
      [[ "${tx:-}" =~ ^[0-9]+$ ]] && ((tx > 0)) || ok=0 ;;
  esac
  st=PASS; ((ok)) || st=FAIL
  evid="[\"$(basename "$cap")\",\"$name-dnsmasq.txt\",\"$name-nginx.txt\",\"$name-hosts.json\",\"$name-domifstat.txt\",\"$(basename "$swb")\",\"$(basename "$swa")\"]"
  "${RJ[@]}" add-entry "$RESULTS" "$run_id" "ac=$acid" "node=$name" "status=$st" "durationS:=$(( $(date +%s) - t0 ))" "note=$note" "evidence:=$evid"
  step neg "$st" "$name $acid: $note"
  [[ "$st" == PASS ]] || neg_rc=1
  return 0
}

nodes_created=1
neg_rc=0
if [[ "$scenario" == vlanneg ]]; then
  for i in "${!NODE_NAMES[@]}"; do neg_run_one "$i"; done
elif ((waves_mode)); then
  stage_begin discover
  for w in "${!WAVES[@]}"; do
    IFS=, read -r -a wn <<<"${WAVES[$w]}"
    for name in "${wn[@]}"; do
      i="$(idx_of "$name")"
      # shellcheck disable=SC2046
      "$INFRA_DIR/node.sh" create "$name" "${NODE_MACS[$i]}" "${NODE_FWS[$i]}" $(node_net_args "$i")
      step node-create ok "$name ${NODE_FWS[$i]} ${NODE_MACS[$i]} (gelombang $((w + 1))/${#WAVES[@]})"
    done
    for name in "${wn[@]}"; do
      i="$(idx_of "$name")"
      is_dry && echo "DRY-RUN-WAIT: gelombang $((w + 1))/${#WAVES[@]} discover: tunggu GET /boot/${NODE_MACS[$i]}.ipxe (log nginx)"
      wait_discovered "${NODE_MACS[$i]}" "${PXE_KVM_DISCOVER_TIMEOUT_SEC:-600}" || die "$name tidak terdeteksi dashboard (GET /boot/<mac>.ipxe)"
      node_cmd poweroff "$name"
      step discover ok "$name (dimatikan untuk gelombang install)"
    done
  done
else
  if [[ "$topology" == vlan ]]; then
    # Kontrol positif capture (AC-7.21): DISCOVER node ber-tag vlan 10 + OFFER/ACK server di trunk0.
    relay_exec "MODE=capture-start CAP_IF=trunk0"; capture_active=trunk0
  fi
  for i in "${!NODE_NAMES[@]}"; do
    # shellcheck disable=SC2046
    "$INFRA_DIR/node.sh" create "${NODE_NAMES[$i]}" "${NODE_MACS[$i]}" "${NODE_FWS[$i]}" $(node_net_args "$i")
    step node-create ok "${NODE_NAMES[$i]} ${NODE_FWS[$i]} ${NODE_MACS[$i]}$([[ "$topology" == vlan ]] && echo " net=${NODE_NETS[$i]}" || true)"
  done
fi

# --- Playwright e2e-kvm -------------------------------------------------------------------
stage_begin playwright
kvm_nodes=""; destroy_nodes=""; failpath_nodes=""
for i in "${!NODE_NAMES[@]}"; do
  kvm_nodes+="${kvm_nodes:+ }${NODE_NAMES[$i]}=${NODE_MACS[$i]}=${NODE_FWS[$i]}=${NODE_IPS[$i]}=${NODE_OSES[$i]}=${NODE_ROLES[$i]}=${NODE_HOSTS[$i]}"
  [[ "${NODE_ROLES[$i]}" == destroy ]] && destroy_nodes+="${destroy_nodes:+ }${NODE_NAMES[$i]}"
  [[ "${NODE_ROLES[$i]}" == failpath ]] && failpath_nodes+="${failpath_nodes:+ }${NODE_NAMES[$i]}"
done
node_gw=10.99.0.1; node_dns=10.99.0.2
if [[ "$topology" == vlan ]]; then node_gw="$SERVER_MGMT_VLAN_IP"; node_dns="$SERVER_PXE_VLAN_IP"; fi
e2e_env=(
  PXE_KVM_BASE_URL="http://$SERVER_IP" PXE_KVM_RUN="$run_id" PXE_KVM_RUNS_DIR="$RUNS_DIR"
  PXE_KVM_SCENARIO="$scenario" PXE_KVM_NODES="$kvm_nodes" PXE_KVM_NODE_USER="$NODE_USER"
  PXE_KVM_SSH_KEY="$RUN_KEY" PXE_KVM_SSH_PUBKEY="$RUN_KEY.pub"
  PXE_KVM_RESET_CMD="$INFRA_DIR/node.sh"
  PXE_KVM_GATEWAY="$node_gw" PXE_KVM_DNS="$node_dns" PXE_KVM_PREFIX=24
  PXE_KVM_SPEC="$m" PXE_KVM_POWER_CMD="$INFRA_DIR/node.sh" PXE_KVM_DESTROY_NODES="$destroy_nodes"
  PXE_KVM_FAILPATH_NODES="$failpath_nodes"
  PXE_KVM_ADMIN_USER="$ADMIN_USERNAME" PXE_KVM_ADMIN_PASS_FILE="$ADMIN_PASS_FILE"
  PXE_KVM_MAX_NODES="$max_nodes" PXE_KVM_WAVES="${WAVES[*]:-}" PXE_KVM_BOOTING_TIMEOUT_MIN="${booting_min:-}"
)
# M7: kontrak suite topologi VLAN (UI tetap http://10.99.0.2; node hanya lewat relay di VM server).
[[ "$topology" == vlan ]] && e2e_env+=(PXE_KVM_TOPOLOGY=vlan PXE_KVM_VLAN="$VLAN_MGMT_ID"
  PXE_KVM_INFRA_KEY="$SSH_KEY" PXE_KVM_RELAY_CMD="$RELAY_SCRIPT" PXE_KVM_SWITCH_IP="$SWITCH_IP")
e2e_rc=0
if is_dry; then
  run env "${e2e_env[@]}" npx --prefix "$DASH_DIR" playwright test -c "$E2E_CONFIG"
  # Test harness (dry-run saja): simulasikan exit Playwright ≠ 0.
  e2e_rc="${PXE_KVM_DRY_PLAYWRIGHT_RC:-0}"
  # Rencana peran destroy (dijalankan suite lewat PXE_KVM_POWER_CMD saat status Installing).
  for i in "${!NODE_NAMES[@]}"; do
    [[ "${NODE_ROLES[$i]}" == destroy ]] || continue
    run "$INFRA_DIR/node.sh" poweroff "${NODE_NAMES[$i]}"
    run "$INFRA_DIR/node.sh" start "${NODE_NAMES[$i]}" "${NODE_MACS[$i]}"
  done
  # Rencana gelombang install (dijalankan suite lewat PXE_KVM_POWER_CMD setelah satu aksi bulk).
  for w in "${!WAVES[@]}"; do
    IFS=, read -r -a wn <<<"${WAVES[$w]}"
    for name in "${wn[@]}"; do i="$(idx_of "$name")"; run "$INFRA_DIR/node.sh" start "$name" "${NODE_MACS[$i]}"; done
    echo "DRY-RUN-WAIT: gelombang $((w + 1))/${#WAVES[@]} install: tunggu Done ${wn[*]} (Playwright, timeout 30 mnt/VM)"
    if ((w + 1 < ${#WAVES[@]})); then for name in "${wn[@]}"; do run "$INFRA_DIR/node.sh" poweroff "$name"; done; fi
  done
else
  (cd "$DASH_DIR" && env "${e2e_env[@]}" npx playwright test -c "$E2E_CONFIG") \
    > "$RUNS_DIR/playwright-kvm.log" 2>&1 || e2e_rc=$?
fi
[[ "$e2e_rc" =~ ^[0-9]+$ ]] || die "PXE_KVM_DRY_PLAYWRIGHT_RC '$e2e_rc' harus angka"
if [[ -n "$capture_active" ]]; then
  # Ringkasan teks DHCP trunk0 (kontrol positif); pcap mentah tetap di VM dan dihapus.
  if is_dry; then relay_exec "MODE=capture-stop CAP_IF=$capture_active"
  else relay_exec "MODE=capture-stop CAP_IF=$capture_active" > "$RUNS_DIR/capture-$capture_active.txt" 2>&1 || true; fi
  capture_active=""
fi
step playwright "$([[ $e2e_rc == 0 ]] && echo ok || echo FAIL)" "exit=$e2e_rc (playwright-kvm.log)"

# --- verifikasi SSH per node (key yang di-inject) -------------------------------------------
# Playwright gagal (mis. satu node macet) -> verifikasi parsial: hanya node yang status host-nya
# `done` di dashboard (GET /api/hosts dengan sesi admin) yang diverifikasi; sisanya NOT_RUN dengan
# alasan. Exit keseluruhan tetap ≠ 0 (kode Playwright; lihat finish).
stage_begin verify
declare -A HOST_STATUS=()
host_statuses() { # -> baris "<mac> <status>"
  if is_dry; then tr ' ' '\n' <<<"${PXE_KVM_DRY_HOST_STATUS:-}" | sed -n 's/^\([0-9a-f:]\{17\}\)=\([a-z]*\)$/\1 \2/p'; return 0; fi
  admin_login "$ADMIN_PASS_FILE" "$SESSION_JAR" >/dev/null || return 1
  curl -fsS --max-time 10 -b "$SESSION_JAR" "http://$SERVER_IP/api/hosts" 2>/dev/null \
    | python3 -I -c 'import json,sys; [print(str(h.get("mac","")).lower(), h.get("status","")) for h in json.load(sys.stdin).get("hosts", [])]'
}
if ((e2e_rc != 0)); then
  while read -r hm hs; do [[ -n "$hm" ]] && HOST_STATUS["$hm"]="$hs"; done < <(host_statuses || true)
  step verify partial "Playwright exit=$e2e_rc: hanya node berstatus done (${#HOST_STATUS[@]} host terbaca)"
fi
verify_eligible() { # verify_eligible <index>: 0 bila node boleh diverifikasi
  local i="$1" st
  ((e2e_rc == 0)) && return 0
  st="${HOST_STATUS[${NODE_MACS[$i]}]:-tidak diketahui}"
  [[ "$st" == done ]] && return 0
  VERIFY_STATUS[$i]=NOT_RUN
  VERIFY_NOTE[$i]="tidak diverifikasi: Playwright exit=$e2e_rc, status host $st (bukan done)"
  step verify NOT_RUN "${NODE_NAMES[$i]} (status host $st)"
  return 1
}
NODE_SSH_OPTS=(-i "$RUN_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
  -o LogLevel=ERROR -o ConnectTimeout=10 -o BatchMode=yes -o IdentitiesOnly=yes)
verify_rc=0
# BUG-M6-10: substitusi perintah berisi daftar `((…)) && echo …` / `[[ … ]] && …` tanpa cabang
# `||` di assignment, atau daftar `&&` sebagai perintah terakhir fungsi, berstatus 1 bila kondisinya
# salah -> skrip berhenti (set -e). Pakai `if` atau tambahkan `|| …`.
verify_partial_suffix() { # -> " (verifikasi parsial, Playwright exit=N)" atau kosong; selalu 0
  if ((e2e_rc != 0)); then printf ' (verifikasi parsial, Playwright exit=%s)' "$e2e_rc"; fi
  return 0
}
# M7: verifikasi node VLAN lewat relay di VM server (host -> root@10.99.0.2 saja). verify-node.sh mode
# EXPECT_VLAN (anak VLAN 20 di parent ber-MAC node), gateway 10.99.20.1, DNS 10.99.10.2; login password
# ditolak (daftar metode sshd dari relay MODE=pwcheck); vlancore: probe isolasi L3 (AC-7.29).
verify_one_vlan() { # verify_one_vlan <index>
  local i="$1" name ip pub renv vout rc pw_out methods partial pout
  partial="$(verify_partial_suffix)"
  name="${NODE_NAMES[$i]}"; ip="${NODE_IPS[$i]}"
  [[ "$ip" =~ ^10\.99\.20\.[0-9]+$ ]] || die "IP node VLAN $ip di luar 10.99.20.*"
  pub="$(cat "$RUN_KEY.pub" 2>/dev/null || echo DRY-RUN-KEY)"
  renv="NODE_IP=$ip NODE_USER=$(printf '%q' "$NODE_USER")"
  renv+=" EXPECT_HOSTNAME=$(printf '%q' "${NODE_HOSTS[$i]}") EXPECT_IP=$ip EXPECT_PREFIX=24"
  renv+=" EXPECT_MAC=${NODE_MACS[$i]} EXPECT_GW=$SERVER_MGMT_VLAN_IP EXPECT_DNS=$SERVER_PXE_VLAN_IP"
  renv+=" EXPECT_USER=$(printf '%q' "$NODE_USER") EXPECT_PUBKEY=$(printf '%q' "$pub") EXPECT_VLAN=$VLAN_MGMT_ID"
  if is_dry && [[ "${PXE_KVM_DRY_VERIFY_EXEC:-0}" != 1 ]]; then
    relay_exec "MODE=verify $renv"
    relay_exec "MODE=pwcheck NODE_IP=$ip NODE_USER=$(printf '%q' "$NODE_USER")"
    VERIFY_STATUS[$i]=DRY-RUN; VERIFY_NOTE[$i]="dry-run: verifikasi relay hanya dicetak$partial"
    return 0
  fi
  vout="$RUNS_DIR/$name-verify.txt"
  rc=0
  { echo "# verify-node lewat relay infra/vlan/relay.sh di $SERVER_NAME (node $ip, VLAN $VLAN_MGMT_ID)"
    relay_exec "MODE=verify $renv"; } > "$vout" 2>&1 || rc=$?
  echo "# verify-node exit=$rc" >> "$vout"
  pw_out="$(relay_exec "MODE=pwcheck NODE_IP=$ip NODE_USER=$(printf '%q' "$NODE_USER")" 2>&1)" || true
  echo "$pw_out" >> "$vout"
  methods="$(sed -n 's/.*Permission denied (\([a-z,-]*\)).*/\1/p' <<<"$pw_out" | head -n 1)"
  if [[ "$pw_out" != *"(exit 0)"* && ",$methods," == *,publickey,* && ",$methods," != *,password,* && ",$methods," != *,keyboard-interactive,* ]]; then
    echo "OK   login password ditolak (server hanya menawarkan: $methods)" >> "$vout"
  else
    echo "FAIL login password tidak ditolak dengan benar" >> "$vout"; rc=1
  fi
  if [[ "$scenario" == vlancore ]]; then
    pout="$RUNS_DIR/$name-probe.txt"
    relay_exec "MODE=probe NODE_IP=$ip NODE_USER=$(printf '%q' "$NODE_USER")" > "$pout" 2>&1 || true
    local pst=FAIL
    if grep -qx 'probe ping 10.99.0.1: unreachable' "$pout" && grep -qx 'probe GET http://10.99.10.2/api/hosts: 403' "$pout" \
      && grep -qx 'probe GET http://10.99.0.2/api/hosts: 403' "$pout"; then pst=PASS; fi
    "${RJ[@]}" add-entry "$RESULTS" "$run_id" ac=AC-7.29 "node=$name" "status=$pst" \
      "note=probe dari node lewat relay: $(grep '^probe ' "$pout" | tr '\n' ';')" "evidence:=[\"$name-probe.txt\"]" || true
    step probe "$pst" "$name ($name-probe.txt)"
  fi
  step verify "$([[ $rc == 0 ]] && echo ok || echo FAIL)" "$name ($name-verify.txt, relay)"
  VERIFY_STATUS[$i]="$([[ $rc == 0 ]] && echo PASS || echo FAIL)"
  VERIFY_NOTE[$i]="verify-node.sh (EXPECT_VLAN=$VLAN_MGMT_ID) lewat relay exit=$rc + cek login password$partial"
  ((rc == 0)) || verify_rc=1
  return 0
}
verify_one() { # verify_one <index>
  local i="$1" name ip pub remote_env vout rc pw_out pw_ok methods partial
  if [[ "$topology" == vlan ]]; then verify_one_vlan "$i"; return 0; fi
  partial="$(verify_partial_suffix)"
  name="${NODE_NAMES[$i]}"; ip="${NODE_IPS[$i]}"
  [[ "$ip" =~ ^10\.99\.0\.[0-9]+$ ]] || die "IP node $ip di luar 10.99.0.*"
  pub="$(cat "$RUN_KEY.pub" 2>/dev/null || echo DRY-RUN-KEY)"
  remote_env="EXPECT_HOSTNAME=$(printf '%q' "${NODE_HOSTS[$i]}") EXPECT_IP=$ip EXPECT_PREFIX=24"
  remote_env+=" EXPECT_MAC=${NODE_MACS[$i]} EXPECT_GW=10.99.0.1 EXPECT_DNS=10.99.0.2"
  remote_env+=" EXPECT_USER=$(printf '%q' "$NODE_USER") EXPECT_PUBKEY=$(printf '%q' "$pub")"
  # PXE_KVM_DRY_VERIFY_EXEC=1 (dry-run saja, untuk test harness infra/test): jalur verifikasi
  # sungguhan dijalankan terhadap ssh PALSU di PATH test (BUG-M6-10: jalur ini dulu tidak teruji).
  if is_dry && [[ "${PXE_KVM_DRY_VERIFY_EXEC:-0}" != 1 ]]; then
    local vs="$VERIFY_SCRIPT"; [[ -f "$vs" ]] || vs=/dev/null
    run ssh "${NODE_SSH_OPTS[@]}" "$NODE_USER@$ip" "$remote_env bash -s" < "$vs"
    VERIFY_STATUS[$i]=DRY-RUN; VERIFY_NOTE[$i]="dry-run: verifikasi hanya dicetak$partial"
    return 0
  fi
  vout="$RUNS_DIR/$name-verify.txt"
  rc=0
  ssh "${NODE_SSH_OPTS[@]}" "$NODE_USER@$ip" "$remote_env bash -s" < "$VERIFY_SCRIPT" > "$vout" 2>&1 || rc=$?
  echo "# verify-node exit=$rc" >> "$vout"
  # Login password harus ditolak: daftar metode yang ditawarkan sshd (mis. "(publickey)" atau
  # "(publickey,gssapi-keyex,gssapi-with-mic)" di Rocky) tidak boleh memuat password/keyboard-
  # interactive. BatchMode mencegah prompt; yang dinilai daftar metode server, bukan hasil login.
  pw_out="$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 \
    -o BatchMode=yes -o PreferredAuthentications=password -o PubkeyAuthentication=no \
    "$NODE_USER@$ip" true 2>&1)" && pw_ok=1 || pw_ok=0
  echo "# ssh PreferredAuthentications=password: $pw_out" >> "$vout"
  methods="$(sed -n 's/.*Permission denied (\([a-z,-]*\)).*/\1/p' <<<"$pw_out" | head -n 1)"
  if ((pw_ok == 0)) && [[ ",$methods," == *,publickey,* && ",$methods," != *,password,* && ",$methods," != *,keyboard-interactive,* ]]; then
    echo "OK   login password ditolak (server hanya menawarkan: $methods)" >> "$vout"
  else
    echo "FAIL login password tidak ditolak dengan benar" >> "$vout"; rc=1
  fi
  step verify "$([[ $rc == 0 ]] && echo ok || echo FAIL)" "$name ($name-verify.txt)"
  VERIFY_STATUS[$i]="$([[ $rc == 0 ]] && echo PASS || echo FAIL)"
  VERIFY_NOTE[$i]="verify-node.sh exit=$rc + cek login password$partial"
  ((rc == 0)) || verify_rc=1
  return 0
}
wait_node_ssh() { # wait_node_ssh <index> <timeout-s>
  local i="$1" t="$2" s=0
  is_dry && return 0
  if [[ "$topology" == vlan ]]; then
    local wmode=wait-ssh
    relay_exec "MODE=$wmode NODE_IP=${NODE_IPS[$i]} NODE_USER=$(printf '%q' "$NODE_USER") WAIT_SEC=$t" >/dev/null 2>&1
    return
  fi
  until ssh "${NODE_SSH_OPTS[@]}" "$NODE_USER@${NODE_IPS[$i]}" true 2>/dev/null; do
    s=$((s + 10)); ((s >= t)) && return 1
    sleep 10
  done
}
if ((waves_mode)); then
  # Verifikasi per gelombang: nyalakan node gelombang (boot dari disk), verifikasi, matikan bila
  # masih ada gelombang berikutnya (batas VM paralel).
  for w in "${!WAVES[@]}"; do
    IFS=, read -r -a wall <<<"${WAVES[$w]}"
    wn=()
    for name in "${wall[@]}"; do i="$(idx_of "$name")"; verify_eligible "$i" && wn+=("$name"); done
    ((${#wn[@]})) || continue
    for name in "${wn[@]}"; do
      i="$(idx_of "$name")"
      if is_dry || ! dom_running "$name"; then node_cmd start "$name" "${NODE_MACS[$i]}"; fi
    done
    for name in "${wn[@]}"; do
      i="$(idx_of "$name")"
      wait_node_ssh "$i" 300 || log "SSH $name belum siap dalam 300 dtk (verifikasi tetap dijalankan)"
      verify_one "$i"
    done
    if ((w + 1 < ${#WAVES[@]})); then for name in "${wn[@]}"; do node_cmd poweroff "$name"; done; fi
  done
elif [[ "$scenario" == vlanneg ]]; then
  : # Uji negatif: tidak ada instalasi -> tidak ada verifikasi SSH (hasil AC-7.26–7.28 di atas).
else
  for i in "${!NODE_NAMES[@]}"; do
    verify_eligible "$i" || continue
    # M7: node VLAN tidak terjangkau host; tunggu SSH lewat relay sebelum verifikasi.
    if [[ "$topology" == vlan ]]; then wait_node_ssh "$i" 300 || log "SSH ${NODE_NAMES[$i]} (relay) belum siap dalam 300 dtk"; fi
    verify_one "$i"
  done
fi
((e2e_rc == 0)) || exit "$e2e_rc"
((neg_rc == 0)) || exit "$neg_rc"
exit "$verify_rc"
