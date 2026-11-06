#!/usr/bin/env bash
# infra/kvm-run.sh <m> [--scenario core|distro|bulk] [--nodes "<spec> ..."] [--waves]
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
set -euo pipefail

usage() {
  echo "pakai: $0 <m> [--scenario core|distro|bulk] [--nodes \"NN:uefi|bios[:destroy|:failpath][:os=ubuntu|debian|rocky] ...\"] [--waves] [--booting-timeout-min N] [--keep-server] [--skip-build]" >&2
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
  *) echo "scenario '$scenario' harus core|distro|bulk" >&2; exit 2 ;;
esac
if [[ -n "$booting_min" ]]; then
  [[ "$booting_min" =~ ^[0-9]{1,4}$ ]] && ((booting_min >= 1 && booting_min <= 1440)) \
    || { echo "--booting-timeout-min '$booting_min' harus 1-1440" >&2; exit 2; }
fi
_repo="$(cd "$(dirname "$0")/.." && pwd)"
KVM_BASE="${PXE_RUNS_DIR:-$_repo/.agent/runs/$m/kvm}"
if [[ -n "$scenario" ]]; then
  export PXE_RUNS_DIR="$KVM_BASE/$scenario"; COMBINED="$KVM_BASE/results.json"
else
  export PXE_RUNS_DIR="$KVM_BASE"; COMBINED=""
fi
export PXE_RUN="$run_id"
source "$(dirname "$0")/lib.sh"

E2E_DIR="$DASH_DIR/e2e-kvm"
E2E_CONFIG="$E2E_DIR/playwright.config.ts"
VERIFY_SCRIPT="$E2E_DIR/verify-node.sh"
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
NODE_SPEC_RE='^([1-8][0-9]):(uefi|bios)(:(destroy|failpath))?(:os=(ubuntu|debian|rocky))?$'
for spec in $nodes_spec; do
  [[ "$spec" =~ $NODE_SPEC_RE ]] || die "spec node '$spec' harus NN:uefi|bios[:destroy|:failpath][:os=ubuntu|debian|rocky] (NN 10-89)"
  nn="${BASH_REMATCH[1]}"; fw="${BASH_REMATCH[2]}"; role="${BASH_REMATCH[4]}"; os="${BASH_REMATCH[6]:-ubuntu}"
  name="pxe-test-$run_id-node$nn"
  assert_name "$name"
  for n in "${NODE_NAMES[@]}"; do [[ "$n" == "$name" ]] && die "node $name ganda"; done
  NODE_NAMES+=("$name"); NODE_MACS+=("52:54:00:99:00:$nn"); NODE_FWS+=("$fw")
  NODE_IPS+=("10.99.0.$((10#$nn + 10))"); NODE_ROLES+=("${role:-install}"); NODE_OSES+=("$os")
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
  export_job_logs
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
  # BUG-M6-2: asersi log server hanya bermakna bila node sudah dibuat; selain itu entri NOT_RUN
  # (bukan FAIL palsu "tidak ada TFTP …") dengan tahap gagal sebagai alasan.
  if ((server_started && nodes_created)) && ! is_dry; then
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
  if ((keep_server || !server_started)); then "$INFRA_DIR/cleanup.sh" "$run_id"; else "$INFRA_DIR/cleanup.sh" "$run_id" --server; fi
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
  [[ "$cst" == PASS ]] || { ((rc != 0)) || rc=1; }
  # Key node, cookie jar sesi admin: tidak dipakai lagi setelah run.
  rm -f "$RUN_KEY" "$RUN_KEY.pub" "$SESSION_JAR"
  "${RJ[@]}" add-entry "$RESULTS" "$run_id" ac=cleanup "status=$cst" "note=${cnote:-semua resource run dihapus; resource terlindungi identik}" \
    "failedStage=${failed_stage:-}" "libvirtDiff=$diff_sum (lihat libvirt-diff.txt)" "protectedIdentical:=$prot_ok" \
    "runDomainsRemaining:=$remain" "serverStopped:=$( ((server_started && !keep_server)) && echo true || echo false)" \
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
max_nodes=$(( (avail_mb - 4096) / 2048 ))
if ((max_nodes < 1)); then max_nodes=1; elif ((max_nodes > 3)); then max_nodes=3; fi
if ((waves_mode)); then
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
"$INFRA_DIR/net-up.sh" >&2; step net-up ok
stage_begin server-up
server_started=1
"$INFRA_DIR/server-up.sh"; step server-up ok
stage_begin deploy
admin_pass_new "$ADMIN_PASS_FILE"
step admin-pass ok "$(basename "$ADMIN_PASS_FILE") (0600, isi tidak dicetak)"
PXE_ADMIN_PASS_FILE="$ADMIN_PASS_FILE" PXE_DEPLOY_BOOTING_TIMEOUT_MIN="$booting_min" "$INFRA_DIR/deploy-dashboard.sh"
step deploy ok "admin=$ADMIN_USERNAME booting_timeout_min=${booting_min:-default}"

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
if is_dry; then
  ssh_root 'bash -s' < "$INFRA_DIR/server/verify-listen.sh"
else
  {
    rc=0
    ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'bash -s' < "$INFRA_DIR/server/verify-listen.sh" || rc=1
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
stage_begin nodes
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
nodes_created=1
if ((waves_mode)); then
  stage_begin discover
  for w in "${!WAVES[@]}"; do
    IFS=, read -r -a wn <<<"${WAVES[$w]}"
    for name in "${wn[@]}"; do
      i="$(idx_of "$name")"
      "$INFRA_DIR/node.sh" create "$name" "${NODE_MACS[$i]}" "${NODE_FWS[$i]}"
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
  for i in "${!NODE_NAMES[@]}"; do
    "$INFRA_DIR/node.sh" create "${NODE_NAMES[$i]}" "${NODE_MACS[$i]}" "${NODE_FWS[$i]}"
    step node-create ok "${NODE_NAMES[$i]} ${NODE_FWS[$i]} ${NODE_MACS[$i]}"
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
e2e_env=(
  PXE_KVM_BASE_URL="http://$SERVER_IP" PXE_KVM_RUN="$run_id" PXE_KVM_RUNS_DIR="$RUNS_DIR"
  PXE_KVM_SCENARIO="$scenario" PXE_KVM_NODES="$kvm_nodes" PXE_KVM_NODE_USER="$NODE_USER"
  PXE_KVM_SSH_KEY="$RUN_KEY" PXE_KVM_SSH_PUBKEY="$RUN_KEY.pub"
  PXE_KVM_RESET_CMD="$INFRA_DIR/node.sh"
  PXE_KVM_GATEWAY=10.99.0.1 PXE_KVM_DNS=10.99.0.2 PXE_KVM_PREFIX=24
  PXE_KVM_SPEC="$m" PXE_KVM_POWER_CMD="$INFRA_DIR/node.sh" PXE_KVM_DESTROY_NODES="$destroy_nodes"
  PXE_KVM_FAILPATH_NODES="$failpath_nodes"
  PXE_KVM_ADMIN_USER="$ADMIN_USERNAME" PXE_KVM_ADMIN_PASS_FILE="$ADMIN_PASS_FILE"
  PXE_KVM_MAX_NODES="$max_nodes" PXE_KVM_WAVES="${WAVES[*]:-}" PXE_KVM_BOOTING_TIMEOUT_MIN="${booting_min:-}"
)
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
verify_one() { # verify_one <index>
  local i="$1" name ip pub remote_env vout rc pw_out pw_ok methods partial
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
else
  for i in "${!NODE_NAMES[@]}"; do verify_eligible "$i" && verify_one "$i"; done
fi
((e2e_rc == 0)) || exit "$e2e_rc"
exit "$verify_rc"
