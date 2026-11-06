#!/usr/bin/env bash
# Diagnostik T15 Rocky (BUG-M6-1 memblokir kvm-run.sh di server-check). Memakai script infra TANPA
# modifikasi (net-up, server-up, deploy-dashboard, node.sh, cleanup.sh, assert-server-logs.sh,
# redact-evidence.sh) dan suite e2e-kvm yang sama; hanya cek media Rocky diganti ke path ISO nyata
# (Minimal/). Cleanup selalu (trap EXIT).
set -euo pipefail
WT=/home/syawal/Project/PXE-BOOT/.agent/wt-m6-smoke
export PXE_RUN=m6
export PXE_RUNS_DIR=/home/syawal/Project/PXE-BOOT/.agent/wt-m6/.agent/runs/m6/smoke/attempt3-rocky-manual
mkdir -p "$PXE_RUNS_DIR"
source "$WT/infra/lib.sh"
S="$RUNS_DIR/manual-run.txt"
step() { printf '%s %-16s %s\n' "$(date -u +%FT%TZ)" "$1" "${2:-}" | tee -a "$S" >&2; }
ts="$(date -u +%Y%m%dT%H%M%SZ)"
NAME=pxe-test-m6-node42; MAC=52:54:00:99:00:42; IP=10.99.0.52; HN=m6-node42; USER_N=m6admin
RUN_KEY="$KEYS_DIR/pxe-test-m6-$ts-node_ed25519"
PASS="$KEYS_DIR/m6-admin.pass"
JAR="$KEYS_DIR/pxe-test-m6-$ts-session.jar"
server_started=0
snap() { { echo "# $(date -u +%FT%TZ) list --all"; virsh_q list --all; echo "# net-list --all"; virsh_q net-list --all; } > "$1" 2>&1; }
finish() {
  local rc=$? pw=""
  trap - EXIT; set +e
  [[ -s "$PASS" ]] && pw="$(cat "$PASS")"
  step finish "rc=$rc"
  sed -e 's/\x1b\[[0-9;?]*[A-Za-z]//g' -e 's/\r//g' "$RUNS_DIR/$NAME-console.log" 2>/dev/null | tr -cd '\11\12\40-\176' > "$RUNS_DIR/$NAME-console.txt"
  if ((server_started)); then
    ssh "${SSH_OPTS[@]}" root@$SERVER_IP 'cat /var/log/dnsmasq-pxe.log' > "$RUNS_DIR/server-dnsmasq.txt" 2>&1
    ssh "${SSH_OPTS[@]}" root@$SERVER_IP 'cat /var/log/nginx/pxe-access.log' > "$RUNS_DIR/server-nginx.txt" 2>&1
    ssh "${SSH_OPTS[@]}" root@$SERVER_IP 'cat /var/log/nginx/error.log' > "$RUNS_DIR/server-nginx-error.txt" 2>&1
    ssh "${SSH_OPTS[@]}" root@$SERVER_IP 'journalctl -u pxe-dashboard --no-pager -o short-iso' > "$RUNS_DIR/server-pxe-dashboard-journal.txt" 2>&1
    if [[ -s "$PASS" ]] && admin_login "$PASS" "$JAR" >/dev/null; then
      jobs="$(curl -fsS -b "$JAR" "http://$SERVER_IP/api/jobs?hostId=${MAC//:/}&limit=200")"
      { printf '{"node":"%s","jobs":%s,"logs":{' "$NAME" "$jobs"; f=1
        for id in $(grep -oE '"id":"job-[0-9a-f-]{36}"' <<<"$jobs" | cut -d'"' -f4 | sort -u); do ((f)) || printf ','; f=0
          printf '"%s":%s' "$id" "$(curl -fsS -b "$JAR" "http://$SERVER_IP/api/jobs/$id/logs?format=json")"; done; printf '}}\n'; } > "$RUNS_DIR/jobs-$NAME.json"
    fi
    PXE_RESULTS_RUN=m6 "$INFRA_DIR/assert-server-logs.sh" "$RUNS_DIR" "$NAME=$MAC=uefi=1=ks.cfg"; step server-logs "exit=$?"
  fi
  "$INFRA_DIR/node.sh" destroy "$NAME" "$MAC" >/dev/null 2>&1
  "$INFRA_DIR/cleanup.sh" m6 --server; step cleanup "exit=$?"
  snap "$RUNS_DIR/libvirt-after.txt"
  diff <(grep -vE '^#' "$RUNS_DIR/libvirt-before.txt" | awk '{print $2,$3,$4}' | sort) <(grep -vE '^#' "$RUNS_DIR/libvirt-after.txt" | awk '{print $2,$3,$4}' | sort) > "$RUNS_DIR/libvirt-diff.txt"; step libvirt-diff "exit=$? (lihat libvirt-diff.txt)"
  rm -f "$RUN_KEY" "$RUN_KEY.pub" "$JAR"
  "$INFRA_DIR/redact-evidence.sh" "$RUNS_DIR"; step redact "exit=$?"
  if [[ -n "$pw" ]]; then
    if grep -rqF -f <(printf '%s\n' "$pw") "$RUNS_DIR"; then step admin-pass "FAIL bocor"; else step admin-pass "ok tidak ada di bukti"; fi
  fi
  rm -f "$PASS"
  step result "rc=$rc"
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT TERM
: > "$S"
snap "$RUNS_DIR/libvirt-before.txt"
dom_exists "$NAME" && die "$NAME sudah ada"
step mem "$(grep MemAvailable /proc/meminfo)"
"$INFRA_DIR/net-up.sh" >&2; step net-up ok
server_started=1
"$INFRA_DIR/server-up.sh"; step server-up ok
admin_pass_new "$PASS"; step admin-pass "baru (0600)"
PXE_ADMIN_PASS_FILE="$PASS" SKIP_BUILD=1 "$INFRA_DIR/deploy-dashboard.sh"; step deploy ok
{
  for p in rocky-9/images/pxeboot/vmlinuz rocky-9/images/pxeboot/initrd.img rocky-9/.treeinfo rocky-9/Minimal/repodata/repomd.xml rocky-9/BaseOS/repodata/repomd.xml; do
    printf 'HEAD /media/%s %s\n' "$p" "$(curl -sSI --max-time 10 -o /dev/null -w '%{http_code}' "http://$SERVER_IP/media/$p")"
  done
  printf 'GET /login %s\n' "$(curl -sS -o /dev/null -w '%{http_code}' "http://$SERVER_IP/login")"
  printf 'GET /api/settings tanpa sesi %s\n' "$(curl -sS -o /dev/null -w '%{http_code}' "http://$SERVER_IP/api/settings")"
} > "$RUNS_DIR/server-check-manual.txt"
step server-check "$(tr '\n' ';' < "$RUNS_DIR/server-check-manual.txt")"
ssh-keygen -q -t ed25519 -N '' -C "pxe-test-m6-$ts" -f "$RUN_KEY"
"$INFRA_DIR/node.sh" create "$NAME" "$MAC" uefi; step node-create "$NAME"
e2e_rc=0
(cd "$WT/dashboard" && env PXE_KVM_BASE_URL=http://$SERVER_IP PXE_KVM_RUN=m6 PXE_KVM_RUNS_DIR="$RUNS_DIR" PXE_KVM_SCENARIO= \
  PXE_KVM_NODES="$NAME=$MAC=uefi=$IP=rocky=install=$HN" PXE_KVM_NODE_USER=$USER_N PXE_KVM_SSH_KEY="$RUN_KEY" PXE_KVM_SSH_PUBKEY="$RUN_KEY.pub" \
  PXE_KVM_RESET_CMD="$INFRA_DIR/node.sh" PXE_KVM_GATEWAY=10.99.0.1 PXE_KVM_DNS=10.99.0.2 PXE_KVM_PREFIX=24 PXE_KVM_SPEC=m6 \
  PXE_KVM_POWER_CMD="$INFRA_DIR/node.sh" PXE_KVM_DESTROY_NODES= PXE_KVM_FAILPATH_NODES= PXE_KVM_ADMIN_USER=pxeadmin PXE_KVM_ADMIN_PASS_FILE="$PASS" \
  PXE_KVM_MAX_NODES=3 PXE_KVM_WAVES= PXE_KVM_BOOTING_TIMEOUT_MIN= npx playwright test -c e2e-kvm/playwright.config.ts) > "$RUNS_DIR/playwright-kvm.log" 2>&1 || e2e_rc=$?
step playwright "exit=$e2e_rc"
# Verifikasi SSH (sama dengan kvm-run.sh verify_one), dijalankan walau playwright gagal bila SSH hidup.
NSO=(-i "$RUN_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 -o BatchMode=yes -o IdentitiesOnly=yes)
if ssh "${NSO[@]}" "$USER_N@$IP" true 2>/dev/null; then
  pub="$(cat "$RUN_KEY.pub")"
  renv="EXPECT_HOSTNAME=$HN EXPECT_IP=$IP EXPECT_PREFIX=24 EXPECT_MAC=$MAC EXPECT_GW=10.99.0.1 EXPECT_DNS=10.99.0.2 EXPECT_USER=$USER_N EXPECT_PUBKEY=$(printf '%q' "$pub")"
  vrc=0; ssh "${NSO[@]}" "$USER_N@$IP" "$renv bash -s" < "$WT/dashboard/e2e-kvm/verify-node.sh" > "$RUNS_DIR/$NAME-verify.txt" 2>&1 || vrc=$?
  echo "# verify-node exit=$vrc" >> "$RUNS_DIR/$NAME-verify.txt"
  pw_out="$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes -o PreferredAuthentications=password -o PubkeyAuthentication=no "$USER_N@$IP" true 2>&1)" || true
  echo "# ssh PreferredAuthentications=password: $pw_out" >> "$RUNS_DIR/$NAME-verify.txt"
  step verify "exit=$vrc"
else
  step verify "SSH tidak tersambung"
  vrc=1
fi
((e2e_rc == 0 && vrc == 0))
