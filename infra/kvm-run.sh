#!/usr/bin/env bash
# infra/kvm-run.sh <m> [--nodes "11:uefi 12:bios"] [--keep-server] [--skip-build]
# Orkestrasi suite KVM satu milestone (M4-T7/T13):
#   preflight -> net-up -> server-up -> deploy-dashboard -> server-check -> key sekali pakai ->
#   buat node pxe-test-<m>-nodeNN -> Playwright dashboard/e2e-kvm -> verifikasi SSH per node
#   (dashboard/e2e-kvm/verify-node.sh) -> kumpulkan bukti -> cleanup (SELALU, via trap EXIT).
# Default node: 11:uefi (AC-4.30 gate) dan 12:bios (AC-4.33). Node NN: MAC 52:54:00:99:00:NN,
# IP statis 10.99.0.(10+NN), hostname <m>-nodeNN, user ${PXE_KVM_NODE_USER:-<m>admin}.
# --keep-server : cleanup tanpa --server (VM pxe-test-server dibiarkan menyala untuk debug).
# --skip-build  : deploy memakai build standalone yang sudah ada (SKIP_BUILD=1).
# Bukti: .agent/runs/<m>/kvm/ (kvm-run.txt = ringkasan langkah). INFRA_DRY_RUN=1 didukung.
#
# Kontrak env untuk suite Playwright dashboard/e2e-kvm (test-engineer, M4-T13):
#   PXE_KVM_BASE_URL     http://10.99.0.2
#   PXE_KVM_RUN          <m>;  PXE_KVM_RUNS_DIR  dir bukti absolut
#   PXE_KVM_NODES        "pxe-test-<m>-node11=52:54:00:99:00:11=uefi=10.99.0.21 ..." (dipisah spasi)
#   PXE_KVM_NODE_USER    username yang harus diset di dashboard
#   PXE_KVM_SSH_PUBKEY   path public key ed25519 sekali pakai (inject lewat dashboard)
#   PXE_KVM_SSH_KEY      path private key pasangannya
#   PXE_KVM_RESET_CMD    path infra/node.sh; panggil "<cmd> reset <name>" setelah Install
#   PXE_KVM_GATEWAY / PXE_KVM_DNS / PXE_KVM_PREFIX   10.99.0.1 / 10.99.0.2 / 24
set -euo pipefail

usage() { echo "pakai: $0 <m> [--nodes \"NN:uefi|bios ...\"] [--keep-server] [--skip-build]" >&2; exit 2; }
[[ $# -ge 1 ]] || usage
m="$1"; shift
[[ "$m" =~ ^m[0-9]+$ ]] || { echo "milestone '$m' harus berbentuk m<angka>" >&2; exit 2; }
nodes_spec="11:uefi 12:bios"; keep_server=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --nodes) [[ $# -ge 2 ]] || usage; nodes_spec="$2"; shift 2 ;;
    --keep-server) keep_server=1; shift ;;
    --skip-build) export SKIP_BUILD=1; shift ;;
    *) usage ;;
  esac
done
export PXE_RUN="$m"
source "$(dirname "$0")/lib.sh"
ensure_dirs

DASH_DIR="$REPO_DIR/dashboard"
E2E_DIR="$DASH_DIR/e2e-kvm"
E2E_CONFIG="$E2E_DIR/playwright.config.ts"
VERIFY_SCRIPT="$E2E_DIR/verify-node.sh"
NODE_USER="${PXE_KVM_NODE_USER:-${m}admin}"
SUMMARY="$RUNS_DIR/kvm-run.txt"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_KEY="$KEYS_DIR/pxe-test-$m-$ts-node_ed25519"

step() { # step <nama> <status> [catatan]
  printf '%s %-18s %s %s\n' "$(date -u +%FT%TZ)" "$1" "$2" "${3:-}" | tee -a "$SUMMARY" >&2
}

# --- daftar node (eksplisit, maks 3; tanpa wildcard) ----------------------------------------
declare -a NODE_NAMES=() NODE_MACS=() NODE_FWS=() NODE_IPS=()
for spec in $nodes_spec; do
  [[ "$spec" =~ ^([1-8][0-9]):(uefi|bios)$ ]] || die "spec node '$spec' harus NN:uefi|bios (NN 10-89)"
  nn="${BASH_REMATCH[1]}"; fw="${BASH_REMATCH[2]}"
  name="pxe-test-$m-node$nn"
  assert_name "$name"
  for n in "${NODE_NAMES[@]}"; do [[ "$n" == "$name" ]] && die "node $name ganda"; done
  NODE_NAMES+=("$name"); NODE_MACS+=("52:54:00:99:00:$nn"); NODE_FWS+=("$fw")
  NODE_IPS+=("10.99.0.$((10#$nn + 10))")
  assert_mac "${NODE_MACS[-1]}"
done
((${#NODE_NAMES[@]} >= 1 && ${#NODE_NAMES[@]} <= 3)) || die "jumlah node harus 1-3"

# --- cleanup selalu (trap EXIT) ------------------------------------------------------------
server_started=0
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
  ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'journalctl -u pxe-dashboard --no-pager -o short-iso' \
    > "$RUNS_DIR/server-pxe-dashboard-journal.txt" 2>&1 || true
}
finish() {
  local rc=$? i
  trap - EXIT INT TERM
  set +e
  step evidence start
  collect_evidence
  step evidence done
  # AC-4.34: samarkan token job (/boot/<mac>/<token>/...) dan hash $6$ di SEMUA bukti (console,
  # nginx, journal, Playwright), lalu scan ulang; masih ada secret -> run gagal.
  if "$INFRA_DIR/redact-evidence.sh" "$RUNS_DIR"; then
    step redact ok
  else
    step redact FAIL "secret tersisa di bukti $RUNS_DIR"
    ((rc != 0)) || rc=1
  fi
  # Cleanup terpisah per VM node yang dibuat run ini (nama eksplisit), lalu cleanup.sh untuk sisa
  # milik run (^pxe-test-<m>-) dan server bila tidak --keep-server.
  for i in "${!NODE_NAMES[@]}"; do
    "$INFRA_DIR/node.sh" destroy "${NODE_NAMES[$i]}" "${NODE_MACS[$i]}" >/dev/null 2>&1
  done
  # Server hanya dimatikan bila run ini sudah sampai tahap server (gagal preflight = tidak disentuh).
  if ((keep_server || !server_started)); then "$INFRA_DIR/cleanup.sh" "$m"; else "$INFRA_DIR/cleanup.sh" "$m" --server; fi
  step cleanup "$([[ $? == 0 ]] && echo done || echo FAIL)" "$( ((keep_server || !server_started)) && echo '(server tidak dimatikan)')"
  # Key node sekali pakai: tidak dipakai lagi setelah run.
  rm -f "$RUN_KEY" "$RUN_KEY.pub"
  step result "$([[ $rc == 0 ]] && echo PASS || echo FAIL)" "exit=$rc"
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT TERM

{ echo "# kvm-run $m $ts nodes=[$nodes_spec] keep_server=$keep_server dry=${INFRA_DRY_RUN:-0}"; } > "$SUMMARY"

# --- preflight -----------------------------------------------------------------------------
pre="$RUNS_DIR/kvm-run-preflight.txt"
{
  echo "# preflight $(date -u +%FT%TZ)"
  for c in virsh virt-install qemu-img ssh scp ssh-keygen curl socat npm npx tar xz; do
    printf '%-13s %s\n' "$c" "$(command -v "$c" || echo MISSING)"
  done
  printf '/dev/kvm      %s\n' "$([[ -c /dev/kvm ]] && echo ok || echo MISSING)"
  printf 'OVMF          %s\n' "$([[ -f $OVMF_CODE && -f $OVMF_VARS ]] && echo ok || echo MISSING)"
  printf 'e2e-kvm       %s\n' "$([[ -f $E2E_CONFIG ]] && echo ok || echo MISSING)"
  printf 'verify-node   %s\n' "$([[ -f $VERIFY_SCRIPT ]] && echo ok || echo MISSING)"
  grep -E '^(MemTotal|MemAvailable):' /proc/meminfo
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
avail_mb=$(( $(awk '/^MemAvailable:/{print $2}' /proc/meminfo) / 1024 ))
dom_running "$SERVER_NAME" || avail_mb=$((avail_mb - ${SERVER_RAM_MB:-3072}))
max_nodes=$(( (avail_mb - 4096) / 2048 )); ((max_nodes < 1)) && max_nodes=1; ((max_nodes > 3)) && max_nodes=3
if ((${#NODE_NAMES[@]} > max_nodes)); then
  is_dry || die "RAM bebas ${avail_mb} MB hanya cukup untuk $max_nodes node"
  log "RAM bebas ${avail_mb} MB hanya cukup untuk $max_nodes node (diabaikan di dry-run)"
fi
# Node milik run ini tidak boleh sudah ada (sisa run gagal -> jalankan cleanup.sh $m dulu).
for name in "${NODE_NAMES[@]}"; do
  dom_exists "$name" && die "$name sudah ada (sisa run sebelumnya); jalankan infra/cleanup.sh $m"
done
step preflight ok "max_nodes=$max_nodes avail_mb=$avail_mb"

# --- server + dashboard --------------------------------------------------------------------
# Output net-up (rencana DRY-RUN / status network) ditampilkan di stderr agar terlihat.
"$INFRA_DIR/net-up.sh" >&2; step net-up ok
server_started=1
"$INFRA_DIR/server-up.sh"; step server-up ok
"$INFRA_DIR/deploy-dashboard.sh"; step deploy ok

check="$RUNS_DIR/server-check.txt"
if is_dry; then
  ssh_root 'bash -s' < "$INFRA_DIR/server/verify-listen.sh"
else
  {
    rc=0
    ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" 'bash -s' < "$INFRA_DIR/server/verify-listen.sh" || rc=1
    echo "# services"
    ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" \
      'for s in dnsmasq nginx nfs-server pxe-dashboard; do printf "%-14s %s\n" $s $(systemctl is-active $s); done; echo "# listen :3000"; ss -ltnH "sport = :3000"' || rc=1
    echo "# host: GET http://$SERVER_IP/api/settings"
    curl -fsS --max-time 10 "http://$SERVER_IP/api/settings" || rc=1; echo
    echo "# host: HEAD http://$SERVER_IP/media/ubuntu-24.04/casper/vmlinuz"
    curl -fsSI --max-time 10 -o /dev/null -w '%{http_code}\n' "http://$SERVER_IP/media/ubuntu-24.04/casper/vmlinuz" || rc=1
    echo "# server-check exit=$rc"
  } > "$check" 2>&1
  grep -q '^# server-check exit=0$' "$check" || die "server-check gagal (lihat $check)"
fi
step server-check ok

# --- key sekali pakai + node ----------------------------------------------------------------
run ssh-keygen -q -t ed25519 -N '' -C "pxe-test-$m-$ts" -f "$RUN_KEY"
for i in "${!NODE_NAMES[@]}"; do
  "$INFRA_DIR/node.sh" create "${NODE_NAMES[$i]}" "${NODE_MACS[$i]}" "${NODE_FWS[$i]}"
  step node-create ok "${NODE_NAMES[$i]} ${NODE_FWS[$i]} ${NODE_MACS[$i]}"
done

# --- Playwright e2e-kvm -------------------------------------------------------------------
kvm_nodes=""
for i in "${!NODE_NAMES[@]}"; do
  kvm_nodes+="${kvm_nodes:+ }${NODE_NAMES[$i]}=${NODE_MACS[$i]}=${NODE_FWS[$i]}=${NODE_IPS[$i]}"
done
e2e_env=(
  PXE_KVM_BASE_URL="http://$SERVER_IP" PXE_KVM_RUN="$m" PXE_KVM_RUNS_DIR="$RUNS_DIR"
  PXE_KVM_NODES="$kvm_nodes" PXE_KVM_NODE_USER="$NODE_USER"
  PXE_KVM_SSH_KEY="$RUN_KEY" PXE_KVM_SSH_PUBKEY="$RUN_KEY.pub"
  PXE_KVM_RESET_CMD="$INFRA_DIR/node.sh"
  PXE_KVM_GATEWAY=10.99.0.1 PXE_KVM_DNS=10.99.0.2 PXE_KVM_PREFIX=24
)
if is_dry; then
  run env "${e2e_env[@]}" npx --prefix "$DASH_DIR" playwright test -c "$E2E_CONFIG"
else
  e2e_rc=0
  (cd "$DASH_DIR" && env "${e2e_env[@]}" npx playwright test -c "$E2E_CONFIG") \
    > "$RUNS_DIR/playwright-kvm.log" 2>&1 || e2e_rc=$?
  step playwright "$([[ $e2e_rc == 0 ]] && echo ok || echo FAIL)" "exit=$e2e_rc (playwright-kvm.log)"
  ((e2e_rc == 0)) || exit "$e2e_rc"
fi

# --- verifikasi SSH per node (key yang di-inject) -------------------------------------------
NODE_SSH_OPTS=(-i "$RUN_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
  -o LogLevel=ERROR -o ConnectTimeout=10 -o BatchMode=yes -o IdentitiesOnly=yes)
verify_rc=0
for i in "${!NODE_NAMES[@]}"; do
  name="${NODE_NAMES[$i]}"; ip="${NODE_IPS[$i]}"
  [[ "$ip" =~ ^10\.99\.0\.[0-9]+$ ]] || die "IP node $ip di luar 10.99.0.*"
  pub="$(cat "$RUN_KEY.pub" 2>/dev/null || echo DRY-RUN-KEY)"
  remote_env="EXPECT_HOSTNAME=$(printf '%q' "$m-node${name##*node}") EXPECT_IP=$ip EXPECT_PREFIX=24"
  remote_env+=" EXPECT_MAC=${NODE_MACS[$i]} EXPECT_GW=10.99.0.1 EXPECT_DNS=10.99.0.2"
  remote_env+=" EXPECT_USER=$(printf '%q' "$NODE_USER") EXPECT_PUBKEY=$(printf '%q' "$pub")"
  if is_dry; then
    vs="$VERIFY_SCRIPT"; [[ -f "$vs" ]] || vs=/dev/null
    run ssh "${NODE_SSH_OPTS[@]}" "$NODE_USER@$ip" "$remote_env bash -s" < "$vs"
    continue
  fi
  vout="$RUNS_DIR/$name-verify.txt"
  rc=0
  ssh "${NODE_SSH_OPTS[@]}" "$NODE_USER@$ip" "$remote_env bash -s" < "$VERIFY_SCRIPT" > "$vout" 2>&1 || rc=$?
  echo "# verify-node exit=$rc" >> "$vout"
  # Login password harus ditolak: sshd hanya menawarkan publickey ("Permission denied (publickey)").
  # BatchMode mencegah prompt; daftar metode dari server yang dinilai, bukan hasil login.
  pw_out="$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 \
    -o BatchMode=yes -o PreferredAuthentications=password -o PubkeyAuthentication=no \
    "$NODE_USER@$ip" true 2>&1)" && pw_ok=1 || pw_ok=0
  echo "# ssh PreferredAuthentications=password: $pw_out" >> "$vout"
  if ((pw_ok == 0)) && [[ "$pw_out" == *"Permission denied (publickey)"* ]]; then
    echo "OK   login password ditolak (server hanya menawarkan publickey)" >> "$vout"
  else
    echo "FAIL login password tidak ditolak dengan benar" >> "$vout"; rc=1
  fi
  step verify "$([[ $rc == 0 ]] && echo ok || echo FAIL)" "$name ($name-verify.txt)"
  ((rc == 0)) || verify_rc=1
done
exit "$verify_rc"
