#!/bin/bash
# infra/vlan/relay.sh — relay SSH TERBATAS di DALAM VM pxe-test-server (M7, DEC-023 §4, DEC-024 O7-A,
# docs/design/M7-plan.md §2.6). Host tidak punya route ke VLAN 10/20 (paket ke sana akan keluar lewat
# default route fisik), jadi host TIDAK PERNAH menyasar 10.99.10.*/10.99.20.*; host hanya menjalankan
#   ssh -i .agent/keys/infra_ed25519 root@10.99.0.2 'MODE=<mode> NODE_IP=… … bash -s' < relay.sh
# dan skrip ini (root VM) yang menghubungi node lewat mgmt20 (10.99.20.1). Tanpa ProxyJump.
#
# Mode (selain ini -> exit 2, tanpa ssh):
#   setup         buat $RELAY_ROOT/pxe-relay (0700). Key node sekali pakai + verify-node.sh lalu
#                 dikirim host lewat STDIN ssh (`cat >`, umask 077) ke direktori itu.
#   status        cek key node ada, mode 0600, milik root (isi TIDAK PERNAH dicetak).
#   teardown      hapus pxe-relay + pxe-cap (key, pcap), hentikan tcpdump relay; cetak
#                 `relay-clean: absent` bila bersih (exit 1 bila tidak).
#   verify        jalankan verify-node.sh DI NODE (EXPECT_* dari env, mode VLAN: EXPECT_VLAN).
#   pwcheck       login password ke node harus ditolak (cetak daftar metode sshd).
#   wait-ssh      tunggu SSH node siap (WAIT_SEC, default 300, maks 1800).
#   reboot        `sudo -n systemctl reboot` di node.
#   probe         dijalankan DI NODE, tujuan tetap: ping 10.99.0.1, GET http://10.99.10.2/api/hosts,
#                 GET http://10.99.0.2/api/hosts (isolasi lapis 3, AC-7.29).
#   capture-start tcpdump DHCP saja di CAP_IF (pxe0|trunk0) -> pcap di VM (bukan di bukti).
#   capture-stop  hentikan tcpdump CAP_IF, cetak ringkasan teks (tcpdump -r -nn -e -v), hapus pcap.
# Mode node (verify|pwcheck|wait-ssh|reboot|probe) wajib NODE_IP ^10\.99\.20\.[0-9]{1,3}$ dan
# NODE_USER ^[a-z_][a-z0-9_-]{0,31}$.
# Env uji (test infra): PXE_RELAY_ROOT (default /root; selain /root hanya path di .agent/tmp/).
set -uo pipefail
export LC_ALL=C

MODE="${MODE:-}"
RELAY_ROOT="${PXE_RELAY_ROOT:-/root}"
if [[ "$RELAY_ROOT" != /root ]]; then
  [[ "$RELAY_ROOT" == */.agent/tmp/* && "$RELAY_ROOT" != *..* ]] || { echo "relay: PXE_RELAY_ROOT tidak diizinkan" >&2; exit 2; }
fi
RDIR="$RELAY_ROOT/pxe-relay"
CDIR="$RELAY_ROOT/pxe-cap"
KEY="$RDIR/node_ed25519"
VERIFY="$RDIR/verify-node.sh"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR
  -o ConnectTimeout=10 -o BatchMode=yes -o IdentitiesOnly=yes)
CAP_FILTER='(udp port 67 or udp port 68) or (vlan and (udp port 67 or udp port 68))'

bad() { echo "relay: $*" >&2; exit 2; }

need_node() {
  [[ "${NODE_IP:-}" =~ ^10\.99\.20\.[0-9]{1,3}$ ]] || bad "NODE_IP '${NODE_IP:-}' harus 10.99.20.x (VLAN management)"
  local o="${NODE_IP##*.}"; ((o >= 1 && o <= 254)) || bad "NODE_IP '$NODE_IP' bukan alamat host"
  [[ "${NODE_USER:-}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || bad "NODE_USER tidak valid"
  [[ -f "$KEY" ]] || { echo "relay: key node belum dipasang (MODE=setup)" >&2; exit 3; }
}
need_cap_if() {
  [[ "${CAP_IF:-}" == pxe0 || "${CAP_IF:-}" == trunk0 ]] || bad "CAP_IF '${CAP_IF:-}' harus pxe0|trunk0"
}
node_ssh() { ssh "${SSH_OPTS[@]}" "$NODE_USER@$NODE_IP" "$@"; }

case "$MODE" in
  setup)
    rm -rf "$RDIR"
    (umask 077 && mkdir -p "$RDIR") || exit 1
    chmod 700 "$RDIR"
    echo "relay-setup: $RDIR $(stat -c '%a %U' "$RDIR")"
    ;;
  status)
    if [[ -f "$KEY" ]]; then
      echo "relay-key: $(stat -c '%a %U:%G' "$KEY")"
      [[ "$(stat -c '%a' "$KEY")" == 600 ]] || { echo "relay: key node bukan 0600" >&2; exit 1; }
    else
      echo "relay-key: absent"; exit 1
    fi
    if [[ -f "$VERIFY" ]]; then echo "relay-verify-script: present"; else echo "relay-verify-script: absent"; fi
    ;;
  teardown)
    for p in "$CDIR"/*.pid; do
      [[ -f "$p" ]] || continue
      kill "$(cat "$p")" 2>/dev/null || true
    done
    rm -rf "$RDIR" "$CDIR"
    if [[ ! -e "$RDIR" && ! -e "$CDIR" ]]; then echo "relay-clean: absent"
    else echo "relay-clean: PRESENT"; exit 1; fi
    ;;
  verify)
    need_node
    [[ -f "$VERIFY" ]] || { echo "relay: verify-node.sh belum dipasang" >&2; exit 3; }
    renv=""
    for v in EXPECT_HOSTNAME EXPECT_IP EXPECT_PREFIX EXPECT_MAC EXPECT_GW EXPECT_DNS EXPECT_USER EXPECT_PUBKEY EXPECT_VLAN; do
      [[ -n "${!v:-}" ]] && renv+=" $v=$(printf '%q' "${!v}")"
    done
    node_ssh "${renv# } bash -s" < "$VERIFY"
    ;;
  pwcheck)
    need_node
    out="$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 \
      -o BatchMode=yes -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      "$NODE_USER@$NODE_IP" true 2>&1)" && rc=0 || rc=$?
    echo "# ssh PreferredAuthentications=password (exit $rc): $out"
    ;;
  wait-ssh)
    need_node
    t="${WAIT_SEC:-300}"
    [[ "$t" =~ ^[0-9]{1,4}$ ]] && ((t >= 1 && t <= 1800)) || bad "WAIT_SEC harus 1-1800"
    s=0
    until node_ssh true 2>/dev/null; do
      s=$((s + 10)); ((s >= t)) && { echo "relay-wait-ssh: TIMEOUT ${t}s $NODE_IP"; exit 1; }
      sleep 10
    done
    echo "relay-wait-ssh: OK $NODE_IP (${s}s)"
    ;;
  reboot)
    need_node
    node_ssh 'sudo -n systemctl reboot' 2>&1 || true
    echo "relay-reboot: dikirim ke $NODE_IP"
    ;;
  probe)
    need_node
    node_ssh 'bash -s' <<'PROBE'
if ping -c 2 -W 2 10.99.0.1 >/dev/null 2>&1; then echo "probe ping 10.99.0.1: reachable"; else echo "probe ping 10.99.0.1: unreachable"; fi
for u in http://10.99.10.2/api/hosts http://10.99.0.2/api/hosts; do
  c="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$u" 2>/dev/null)" || true
  echo "probe GET $u: ${c:-000}"
done
PROBE
    ;;
  capture-start)
    need_cap_if
    command -v tcpdump >/dev/null || { echo "relay: tcpdump tidak ada" >&2; exit 3; }
    (umask 077 && mkdir -p "$CDIR")
    if [[ -f "$CDIR/$CAP_IF.pid" ]]; then kill "$(cat "$CDIR/$CAP_IF.pid")" 2>/dev/null || true; fi
    rm -f "$CDIR/$CAP_IF.pcap"
    # -Z root: tulis ke direktori root 0700; hanya DHCP (tanpa HTTP -> tanpa token di pcap, O9-A).
    setsid tcpdump -i "$CAP_IF" -nn -e -U -Z root -w "$CDIR/$CAP_IF.pcap" "$CAP_FILTER" \
      </dev/null >"$CDIR/$CAP_IF.log" 2>&1 &
    echo $! > "$CDIR/$CAP_IF.pid"
    sleep 1
    if kill -0 "$(cat "$CDIR/$CAP_IF.pid")" 2>/dev/null; then echo "relay-capture: started $CAP_IF"
    else echo "relay-capture: GAGAL $CAP_IF"; cat "$CDIR/$CAP_IF.log" 2>/dev/null; exit 1; fi
    ;;
  capture-stop)
    need_cap_if
    if [[ -f "$CDIR/$CAP_IF.pid" ]]; then
      kill "$(cat "$CDIR/$CAP_IF.pid")" 2>/dev/null || true
      sleep 1
      rm -f "$CDIR/$CAP_IF.pid"
    fi
    echo "# capture $CAP_IF filter: $CAP_FILTER"
    if [[ -f "$CDIR/$CAP_IF.pcap" ]]; then
      tcpdump -nn -e -v -r "$CDIR/$CAP_IF.pcap" 2>&1
      rm -f "$CDIR/$CAP_IF.pcap"
    else
      echo "relay-capture: tidak ada pcap untuk $CAP_IF"
    fi
    ;;
  *) bad "MODE '$MODE' tidak dikenal" ;;
esac
