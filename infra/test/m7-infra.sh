# shellcheck shell=bash
# infra/test/m7-infra.sh — test shell infra M7 dasar (M7-T3/T4/T5, backend-dev; test-engineer
# menambah di T9). Di-source oleh run.sh (harness.sh: virsh/ssh/curl PALSU + sandbox di project).
# Perintah tambahan yang hanya dibutuhkan script DI DALAM VM (ip, bridge, ss, systemctl, nft, ...)
# dipalsukan per test di $SB/bin (TIDAK di fake-bin global: test_fake_path_isolated menuntut `ss`
# tidak ada di PATH test umum).
#   AC-7.14 network VLAN (XML, net-up/net-down --topology vlan, tolak <ip>/<forward>/<dhcp>)
#   AC-7.15 switch-up dry-run + pxe-switch.sh apply/apply-port/verify (ip/bridge palsu)
#   AC-7.16 profil server (static) + verify-listen-vlan.sh (ss palsu) + server-up/deploy --topology vlan
#   AC-7.17 relay.sh (mode/NODE_IP ditolak, key tidak dicetak) + asersi statis host tidak menyasar
#           10.99.10.*/10.99.20.*
#   AC-7.18 verify-node.sh EXPECT_VLAN (ip palsu)
#   AC-7.19 kvm-run.sh skenario VLAN (run id, node, IP, network, max_nodes, cleanup switch/relay)

_m7_json() { python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))" "$@"; }
_m7_meminfo() { printf 'MemTotal:       %d kB\nMemAvailable:   %d kB\n' $((64 * 1024 * 1024)) $(($1 * 1024)) > "$SB/meminfo"; echo "$SB/meminfo"; }
_m7_bin() { mkdir -p "$SB/bin"; export SB; [[ ":$PATH:" == *":$SB/bin:"* ]] || export PATH="$SB/bin:$PATH"; }
_m7_fake() { # _m7_fake <nama> <isi-script>: perintah palsu di $SB/bin (mencatat ke $FAKE_LOG)
  _m7_bin
  printf '#!/usr/bin/env bash\necho "%s $*" >> "$FAKE_LOG"\n%s\n' "$1" "$2" > "$SB/bin/$1"
  chmod +x "$SB/bin/$1"
}
_m7_vlan_sandbox() { # sandbox kvm-run VLAN: base server/switch siap, ISO + cloud image ada
  _prepare_kvm_run_sandbox
  : > "$PXE_AGENT_DIR/media/ubuntu-24.04-server-cloudimg-amd64.img"
  : > "$PXE_AGENT_DIR/vms/pxe-test-switch-base.qcow2"; echo test > "$PXE_AGENT_DIR/vms/pxe-test-switch-base.ready"
}

# ---- AC-7.14 ---------------------------------------------------------------------------------
test_m7_net_xml() {
  local n f x br seen=""
  for n in trunk port1 port2; do
    f="$INFRA_DIR_UNDER_TEST/net/pxe-test-$n.xml"
    assert_file "$f"
    x="$(cat "$f")"   # file mentah (termasuk komentar) juga tanpa elemen terlarang
    assert_not_contains "$x" "<ip" "$n tanpa <ip>"
    assert_not_contains "$x" "<forward" "$n tanpa <forward>"
    assert_not_contains "$x" "<dhcp" "$n tanpa <dhcp>"
    assert_contains "$x" "<name>pxe-test-$n</name>"
    assert_contains "$x" "<dns enable='no'/>"
    br="$(sed -n "s:.*<bridge name='\([^']*\)'.*:\1:p" "$f")"
    [[ -n "$br" && ${#br} -le 15 ]] || _fail "$n: bridge '$br' kosong/>15"
    [[ "$br" != virbr-pxe && "$br" != virbr-pxenat ]] || _fail "$n: bridge bentrok $br"
    [[ " $seen " != *" $br "* ]] || _fail "bridge $br ganda"
    seen+=" $br"
  done
}

test_m7_net_up_down_vlan() {
  export INFRA_DRY_RUN=1
  run_infra net-up.sh --topology vlan
  assert_eq "$RC" 0 "$OUT"
  local n
  for n in pxe-test pxe-test-nat pxe-test-trunk pxe-test-port1 pxe-test-port2; do
    assert_match "$OUT" "^DRY-RUN: virsh -c qemu:///system net-define .*/net/$n\.xml$"
    assert_match "$OUT" "^DRY-RUN: virsh -c qemu:///system net-start $n$"
  done
  assert_empty "$(mutating_calls)"
  # Flat (default) tetap dua network.
  run_infra net-up.sh
  assert_eq "$(grep -c 'net-define' <<<"$OUT")" 2
  run_infra net-up.sh --topology evil
  assert_ne "$RC" 0
  # virsh palsu ber-state: idempoten.
  unset INFRA_DRY_RUN
  run_infra net-up.sh --topology vlan
  assert_eq "$RC" 0 "$OUT"
  for n in pxe-test-trunk pxe-test-port1 pxe-test-port2; do assert_eq "$(cat "$FAKE_STATE/net/$n")" yes; done
  : > "$FAKE_LOG"; run_infra net-up.sh --topology vlan
  assert_empty "$(mutating_calls)" "net-up vlan kedua harus idempoten"
  # net-down --topology vlan: kelimanya.
  export INFRA_DRY_RUN=1
  run_infra net-down.sh --topology vlan
  assert_eq "$RC" 0 "$OUT"
  for n in pxe-test pxe-test-nat pxe-test-trunk pxe-test-port1 pxe-test-port2; do
    assert_match "$OUT" "^DRY-RUN: virsh -c qemu:///system net-undefine $n$"
  done
  assert_no_match "$OUT" "net-(destroy|undefine) (default|int)$"
}

test_m7_net_up_rejects_bad_xml() {
  export INFRA_DRY_RUN=1
  local d="$SB/netxml" bad
  for bad in "<ip address='10.99.10.1' netmask='255.255.255.0'/>" "<forward mode='nat'/>" "<dhcp><range start='10.99.10.5' end='10.99.10.9'/></dhcp>"; do
    rm -rf "$d"; mkdir -p "$d"; cp "$INFRA_DIR_UNDER_TEST"/net/*.xml "$d/"
    sed -i "s#<dns enable='no'/>#<dns enable='no'/>\n  $bad#" "$d/pxe-test-port1.xml"
    : > "$FAKE_LOG"
    PXE_NET_XML_DIR="$d" run_infra net-up.sh --topology vlan
    assert_ne "$RC" 0 "XML dengan $bad harus ditolak"
    assert_no_match "$OUT" "DRY-RUN: virsh" "tidak ada virsh sebelum validasi lulus"
    assert_empty "$(grep '^virsh .*net-' "$FAKE_LOG" | grep -v 'net-info' || true)"
  done
  # Nama di XML != nama file -> ditolak.
  rm -rf "$d"; mkdir -p "$d"; cp "$INFRA_DIR_UNDER_TEST"/net/*.xml "$d/"
  sed -i 's#<name>pxe-test-port2</name>#<name>default</name>#' "$d/pxe-test-port2.xml"
  PXE_NET_XML_DIR="$d" run_infra net-up.sh --topology vlan
  assert_ne "$RC" 0
  assert_no_match "$OUT" "DRY-RUN: virsh"
  # Komentar yang menyebut <ip> tidak memicu penolakan (komentar dibuang dulu).
  rm -rf "$d"; mkdir -p "$d"; cp "$INFRA_DIR_UNDER_TEST"/net/*.xml "$d/"
  sed -i '1i <!-- catatan: tanpa <ip> dan <forward>,\n     multi-baris <dhcp> -->' "$d/pxe-test-trunk.xml"
  PXE_NET_XML_DIR="$d" run_infra net-up.sh --topology vlan
  assert_eq "$RC" 0 "$OUT"
}

# ---- AC-7.15 ---------------------------------------------------------------------------------
test_m7_switch_up_dry() {
  _m7_vlan_sandbox
  export INFRA_DRY_RUN=1
  rm -f "$PXE_AGENT_DIR/vms/pxe-test-switch-base."*
  run_infra switch-up.sh
  assert_eq "$RC" 0 "$OUT"
  local o vi; o="$(unq "$OUT")"
  assert_match "$o" "DRY-RUN: qemu-img convert -O qcow2 .*/media/ubuntu-24\.04-server-cloudimg-amd64\.img .*/vms/pxe-test-switch-base\.qcow2"
  assert_match "$o" "DRY-RUN: qemu-img create -q -f qcow2 -b .*/vms/pxe-test-switch-base\.qcow2 -F qcow2 .*/vms/pxe-test-switch\.qcow2"
  assert_match "$o" "DRY-RUN: cloud-localds .*/vms/pxe-test-switch-seed\.iso "
  vi="$(grep 'DRY-RUN: virt-install' <<<"$o")"
  assert_contains "$vi" "--name pxe-test-switch "
  local mem; mem="$(sed -E 's/.*--memory ([0-9]+) .*/\1/' <<<"$vi")"
  [[ "$mem" =~ ^[0-9]+$ ]] && ((mem <= 1024)) || _fail "RAM switch '$mem' > 1024"
  assert_contains "$vi" "--network network=pxe-test,mac=52:54:00:99:02:01,"
  assert_contains "$vi" "--network network=pxe-test-trunk,mac=52:54:00:99:02:02,"
  assert_contains "$vi" "--network network=pxe-test-port1,mac=52:54:00:99:02:03,"
  assert_contains "$vi" "--network network=pxe-test-port2,mac=52:54:00:99:02:04,"
  assert_not_contains "$vi" "pxe-test-nat" "switch tanpa NAT"
  assert_eq "$(grep -o -- '--network ' <<<"$vi" | wc -l)" 4
  # ssh hanya root@10.99.0.3 dengan key infra.
  assert_no_match "$(grep -E 'DRY-RUN: (ssh|scp) ' <<<"$o")" "@10\.99\.(10|20)\."
  assert_match "$o" "DRY-RUN: ssh -i .*/keys/infra_ed25519 .* root@10\.99\.0\.3 /usr/local/sbin/pxe-switch\.sh verify"
  assert_empty "$(mutating_calls)"
}

_m7_switch_fakes() { # ip/bridge palsu; `bridge vlan show` dari $SB/vlan-show
  : > "$SB/vlan-show"
  _m7_fake ip 'case "$*" in "link show dev br0") exit "${FAKE_BR_EXISTS:-1}" ;; "-d link show dev br0") echo "7: br0: <UP> mtu 1500 bridge forward_delay 1500 stp_state 0 vlan_filtering 1 vlan_protocol 802.1Q vlan_default_pvid 0" ;; "-o link show dev "*) echo "5: ${*: -1}: <UP> mtu 1500 master br0 state UP" ;; esac; exit 0'
  _m7_fake bridge '[[ "$*" == "vlan show" || "$*" == "-d vlan show" ]] && cat "$SB/vlan-show"; exit 0'
}
test_m7_pxe_switch_apply() {
  _m7_switch_fakes
  export PXE_SWITCH_CONF="$SB/pxe-switch.conf"
  cp "$INFRA_DIR_UNDER_TEST/switch/pxe-switch.conf" "$PXE_SWITCH_CONF"
  local S="$INFRA_DIR_UNDER_TEST/switch/pxe-switch.sh" got exp
  set +e; OUT="$(bash "$S" apply 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$OUT"
  got="$(grep -E '^(ip|bridge) ' "$FAKE_LOG" | grep -vE '^(ip link show|bridge vlan show)')"
  exp="ip link add name br0 type bridge vlan_filtering 1 vlan_default_pvid 0 stp_state 0
ip addr flush dev br0
ip link set dev sw-up master br0
ip link set dev sw-up up
ip link set dev sw-p1 master br0
ip link set dev sw-p1 up
ip link set dev sw-p2 master br0
ip link set dev sw-p2 up
bridge vlan add dev sw-up vid 10
bridge vlan add dev sw-up vid 20
bridge vlan add dev sw-p1 vid 10 pvid untagged
bridge vlan add dev sw-p1 vid 20
bridge vlan add dev sw-p2 vid 20 pvid untagged
ip link set dev br0 up"
  assert_eq "$got" "$exp" "himpunan perintah apply (tabel §2.2)"
  assert_no_match "$got" "ip (addr|address) add" "br0/port tanpa alamat"
  # apply-port tagged10 / access20 (dengan VLAN lama di sw-p2 -> dihapus dulu).
  printf 'port              vlan-id\nsw-p2             20 PVID Egress Untagged\n' > "$SB/vlan-show"
  : > "$FAKE_LOG"
  set +e; OUT="$(bash "$S" apply-port sw-p2 tagged10 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(grep -E '^bridge vlan (add|del)' "$FAKE_LOG")" "bridge vlan del dev sw-p2 vid 20
bridge vlan add dev sw-p2 vid 10"
  assert_contains "$(cat "$PXE_SWITCH_CONF")" "SW_P2_PROFILE=tagged10"
  printf 'port              vlan-id\nsw-p2             10\n' > "$SB/vlan-show"
  : > "$FAKE_LOG"
  set +e; OUT="$(bash "$S" apply-port sw-p2 access20 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(grep -E '^bridge vlan (add|del)' "$FAKE_LOG")" "bridge vlan del dev sw-p2 vid 10
bridge vlan add dev sw-p2 vid 20 pvid untagged"
  # Profil / port lain ditolak tanpa perubahan.
  local a
  for a in "apply-port sw-p2 trunk" "apply-port sw-p1 access20" "apply-port sw-p2" "evil"; do
    : > "$FAKE_LOG"
    set +e; OUT="$(eval "bash '$S' $a" 2>&1)"; RC=$?; set -e
    assert_ne "$RC" 0 "$a"
    assert_empty "$(grep -E '^bridge vlan (add|del)' "$FAKE_LOG" || true)" "$a tanpa perubahan"
  done
}

test_m7_pxe_switch_verify() {
  _m7_switch_fakes
  export PXE_SWITCH_CONF="$SB/pxe-switch.conf"
  echo "SW_P2_PROFILE=access20" > "$PXE_SWITCH_CONF"
  local S="$INFRA_DIR_UNDER_TEST/switch/pxe-switch.sh"
  printf '%s\n' 'port              vlan-id' 'sw-up             10' '                  20' \
    'sw-p1             10 PVID Egress Untagged' '                  20' 'sw-p2             20 PVID Egress Untagged' > "$SB/vlan-show"
  set +e; OUT="$(bash "$S" verify 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$OUT"
  assert_contains "$OUT" "RESULT: PASS"
  # sw-p1 tanpa PVID untagged VLAN 10 -> FAIL.
  printf '%s\n' 'port              vlan-id' 'sw-up             10' '                  20' \
    'sw-p1             10' '                  20' 'sw-p2             20 PVID Egress Untagged' > "$SB/vlan-show"
  set +e; OUT="$(bash "$S" verify 2>&1)"; RC=$?; set -e
  assert_ne "$RC" 0
  assert_contains "$OUT" "FAIL tabel VLAN berbeda"
}

# ---- AC-7.16 ---------------------------------------------------------------------------------
test_m7_server_profile_static() {
  local V="$INFRA_DIR_UNDER_TEST/server/vlan" d n e
  d="$(grep -vE '^\s*(#|$)' "$V/dnsmasq-vlan.conf")"
  assert_match "$d" "^interface=pxe10$"
  assert_match "$d" "^bind-interfaces$"
  assert_match "$d" "^except-interface=lo,nat0,pxe0,mgmt20$"
  assert_match "$d" "^no-dhcp-interface=pxe0,mgmt20$"
  assert_eq "$(grep -c '^dhcp-range=' <<<"$d")" 1
  assert_match "$d" "^dhcp-range=pxe10,10\.99\.10\.100,10\.99\.10\.200,"
  assert_match "$d" "^dhcp-option=3$"
  assert_no_match "$d" "option:router,"
  assert_match "$d" "^dhcp-boot=tag:ipxe,http://10\.99\.10\.2/boot/"
  assert_no_match "$d" "10\.99\.0\.|^dhcp-range=pxe0|^interface=pxe0"
  # nginx VLAN = nginx flat + tepat satu listen tambahan 10.99.10.2:80 (lokasi identik).
  n="$V/nginx-pxe-vlan.conf"
  assert_eq "$(grep -E '^\s*listen ' "$n" | sed 's/^ *//')" "listen 10.99.0.2:80 default_server;
listen 10.99.10.2:80 default_server;"
  assert_eq "$(grep -vE '^\s*#|^\s*listen ' "$n")" "$(grep -vE '^\s*#|^\s*listen ' "$INFRA_DIR_UNDER_TEST/server/nginx-pxe.conf")" "isi lokasi identik flat"
  assert_eq "$(grep -c 'allow 10.99.0.1; # PXE_ADMIN_ALLOW' "$n")" 2
  assert_not_contains "$(grep -v '^\s*#' "$n")" "10.99.20.1" "nginx tidak listen di mgmt20"
  e="$(grep -vE '^\s*(#|$)' "$V/exports-vlan")"
  assert_eq "$(grep -oE '[0-9.]+/[0-9]+' <<<"$e" | sort -u | tr '\n' ' ')" "10.99.10.0/24 10.99.20.0/24 "
  assert_no_match "$e" "\brw\b"
  assert_eq "$(grep -oE '\((ro|rw)[,)]' <<<"$e" | sort -u)" "(ro,"
  assert_match "$(cat "$V/nfs-vlan.conf")" "^host=10\.99\.10\.2$"
  assert_match "$(cat "$V/apply-profile.sh")" "-h 10\.99\.10\.2"
  assert_match "$(cat "$V/sysctl-vlan.conf")" "^net\.ipv4\.ip_forward=0$"
  assert_match "$(cat "$V/netplan-vlan.yaml")" "macaddress: \"52:54:00:99:01:04\""
  assert_contains "$(cat "$V/apply-profile.sh")" "nginx -t"
  # apply-profile: dnsmasq stop sebelum apa pun, start di akhir.
  local a; a="$(grep -nE 'systemctl (stop|start) dnsmasq' "$V/apply-profile.sh" | cut -d: -f2-)"
  assert_eq "$(head -1 <<<"$a")" "systemctl stop dnsmasq"
  assert_eq "$(tail -1 <<<"$a")" "systemctl start dnsmasq"
}

_m7_listen_fakes() { # ss/ip/systemctl/nft palsu untuk verify-listen-vlan.sh; ss -lntupH dari $SB/ss
  _m7_fake ss '[[ "$1" == -lntupH ]] && cat "$SB/ss"; exit 0'
  _m7_fake ip 'case "$*" in
    "-d -o link show dev pxe10") echo "8: pxe10@trunk0: <UP> mtu 1500 \    link/ether 52:54:00:99:01:04 \    vlan protocol 802.1Q id ${FAKE_PXE10_ID:-10} <REORDER_HDR>" ;;
    "-d -o link show dev mgmt20") echo "9: mgmt20@trunk0: <UP> mtu 1500 \    link/ether 52:54:00:99:01:04 \    vlan protocol 802.1Q id 20 <REORDER_HDR>" ;;
    "-4 -o addr show dev pxe10") echo "8: pxe10    inet 10.99.10.2/24 brd 10.99.10.255 scope global pxe10" ;;
    "-4 -o addr show dev mgmt20") echo "9: mgmt20    inet 10.99.20.1/24 brd 10.99.20.255 scope global mgmt20" ;;
  esac; exit 0'
  _m7_fake systemctl '[[ "$1" == is-active ]] && echo active; exit 0'
  _m7_fake nft 'echo "table inet pxe_guard { chain input { iifname \"nat0\" counter packets 0 bytes 0 drop } }"'
  mkdir -p "$SB/proc/sys/net/ipv4"; echo 0 > "$SB/proc/sys/net/ipv4/ip_forward"
  echo "interface=pxe10" > "$SB/dnsmasq-pxe.conf"
  export PXE_VERIFY_PROC="$SB/proc" PXE_VERIFY_DNSMASQ_CONF="$SB/dnsmasq-pxe.conf"
}
_m7_ss_good() {
  cat <<'SS'
udp UNCONN 0 0 0.0.0.0%pxe10:67 0.0.0.0:* users:(("dnsmasq",pid=1,fd=4))
udp UNCONN 0 0 10.99.10.2:53 0.0.0.0:* users:(("dnsmasq",pid=1,fd=6))
udp UNCONN 0 0 10.99.10.2:69 0.0.0.0:* users:(("dnsmasq",pid=1,fd=8))
tcp LISTEN 0 32 10.99.10.2:53 0.0.0.0:* users:(("dnsmasq",pid=1,fd=7))
tcp LISTEN 0 511 10.99.0.2:80 0.0.0.0:* users:(("nginx",pid=2,fd=5))
tcp LISTEN 0 511 10.99.10.2:80 0.0.0.0:* users:(("nginx",pid=2,fd=6))
tcp LISTEN 0 64 10.99.10.2:2049 0.0.0.0:*
tcp LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=3,fd=3))
tcp LISTEN 0 4096 0.0.0.0:111 0.0.0.0:* users:(("rpcbind",pid=4,fd=4))
SS
}
test_m7_verify_listen_vlan() {
  _m7_listen_fakes
  local S="$INFRA_DIR_UNDER_TEST/server/vlan/verify-listen-vlan.sh" bad
  _m7_ss_good > "$SB/ss"
  set +e; OUT="$(bash "$S" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$(grep FAIL <<<"$OUT")"
  assert_contains "$OUT" "RESULT: PASS"
  assert_no_match "$(cat "$FAKE_LOG")" "systemctl stop dnsmasq"
  for bad in 'udp UNCONN 0 0 0.0.0.0%pxe0:67 0.0.0.0:* users:(("dnsmasq",pid=1,fd=9))' \
             'udp UNCONN 0 0 0.0.0.0:67 0.0.0.0:* users:(("dnsmasq",pid=1,fd=9))' \
             'udp UNCONN 0 0 10.99.20.1:53 0.0.0.0:* users:(("dnsmasq",pid=1,fd=9))' \
             'tcp LISTEN 0 64 10.99.0.2:2049 0.0.0.0:*' \
             'tcp LISTEN 0 511 10.99.20.1:80 0.0.0.0:* users:(("nginx",pid=2,fd=7))'; do
    { _m7_ss_good; echo "$bad"; } > "$SB/ss"
    : > "$FAKE_LOG"
    set +e; OUT="$(bash "$S" 2>&1)"; RC=$?; set -e
    assert_eq "$RC" 1 "harus FAIL: $bad"
    assert_contains "$OUT" "RESULT: FAIL"
    assert_match "$(cat "$FAKE_LOG")" "^systemctl stop dnsmasq$" "dnsmasq dihentikan ($bad)"
  done
  # ip_forward=1 / VLAN id salah -> FAIL.
  _m7_ss_good > "$SB/ss"; echo 1 > "$SB/proc/sys/net/ipv4/ip_forward"
  set +e; OUT="$(bash "$S" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 1; assert_contains "$OUT" "FAIL net.ipv4.ip_forward=1"
  echo 0 > "$SB/proc/sys/net/ipv4/ip_forward"
  set +e; OUT="$(FAKE_PXE10_ID=30 bash "$S" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 1; assert_contains "$OUT" "FAIL pxe10 bukan VLAN id 10 di trunk0"
}

test_m7_server_up_vlan_dry() {
  _m7_vlan_sandbox
  export INFRA_DRY_RUN=1
  run_infra server-up.sh --topology vlan
  assert_eq "$RC" 0 "$OUT"
  local o; o="$(unq "$OUT")"
  assert_match "$o" "DRY-RUN: virt-install .*--name pxe-test-server .*--network network=pxe-test-trunk,mac=52:54:00:99:01:04,model=virtio"
  assert_match "$o" "root@10\.99\.0\.2 systemctl stop dnsmasq"
  assert_match "$o" "root@10\.99\.0\.2 STAGE=/tmp/pxe-test-vlan\.[0-9]{8}T[0-9]{6}Z bash -s"
  # Urutan: stop dnsmasq sebelum apply-profile; apply sebelum verifikasi.
  local l_stop l_apply l_ver
  l_stop="$(grep -n 'systemctl stop dnsmasq' <<<"$o" | head -1 | cut -d: -f1)"
  l_apply="$(grep -n 'STAGE=/tmp/pxe-test-vlan' <<<"$o" | head -1 | cut -d: -f1)"
  l_ver="$(grep -n 'root@10.99.0.2 bash -s$' <<<"$o" | tail -1 | cut -d: -f1)"
  ((l_stop < l_apply && l_apply < l_ver)) || _fail "urutan stop($l_stop) < apply($l_apply) < verify($l_ver)"
  assert_no_match "$o" "@10\.99\.(10|20)\."
  # Flat: tanpa NIC trunk dan tanpa profil VLAN (perilaku M6).
  run_infra server-up.sh
  assert_eq "$RC" 0
  assert_not_contains "$OUT" "pxe-test-trunk"
  assert_not_contains "$OUT" "pxe-test-vlan"
  run_infra server-up.sh --topology bogus
  assert_ne "$RC" 0
}

test_m7_deploy_vlan() {
  export INFRA_DRY_RUN=1 FAKE_ADMIN_HASH='scrypt$15$8$1$c2FsdHNhbHRzYWx0c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g'
  run_infra deploy-dashboard.sh --topology vlan
  assert_eq "$RC" 0 "$OUT"
  # dashboard-vlan.env: nilai §2.3, tanpa hash nyata.
  local e; e="$(cat "$INFRA_DIR_UNDER_TEST/server/dashboard-vlan.env")"
  for kv in PXE_MGMT_CIDR=10.99.10.0/24 PXE_MGMT_GATEWAY=10.99.10.1 PXE_MGMT_DNS=10.99.10.2 PXE_SERVER_IP=10.99.10.2 \
    PXE_DHCP_RANGE=10.99.10.100-10.99.10.200 PXE_DHCP_INTERFACE=pxe10 PXE_BASE_URL=http://10.99.10.2 \
    PXE_MEDIA_URL=http://10.99.10.2/media PXE_ALLOWED_HOSTS=10.99.0.2,10.99.10.2 PXE_VLAN_NETWORKS=20:10.99.20.0/24:10.99.20.1 \
    PXE_ADMIN_PASSWORD_HASH=@PXE_ADMIN_PASSWORD_HASH@ PXE_TRUST_PROXY=1; do
    assert_match "$e" "^$kv$"
  done
  assert_no_match "$e" 'scrypt\$[0-9]'
  # Non-dry dengan dashboard palsu: settings tanpa VLAN 20 -> gagal; dengan VLAN 20 -> sukses.
  unset INFRA_DRY_RUN
  echo running > "$FAKE_STATE/dom/pxe-test-server"; : > "$PXE_AGENT_DIR/keys/infra_ed25519"
  export PXE_DASHBOARD_DIR; PXE_DASHBOARD_DIR="$(_m6_fake_dash)"
  export SKIP_BUILD=1 FAKE_CURL_HTTP=1
  FAKE_CURL_SETTINGS_BODY='{"cidr":"10.99.10.0/24","adminConfigured":true}' run_infra deploy-dashboard.sh --topology vlan
  assert_ne "$RC" 0 "tanpa vlanNetworks harus gagal"
  assert_contains "$OUT" "vlanNetworks tanpa VLAN 20"
  FAKE_CURL_SETTINGS_BODY='{"cidr":"10.99.10.0/24","vlanNetworks":[{"vlan":20,"cidr":"10.99.20.0/24","prefix":24,"gateway":"10.99.20.1"}],"adminConfigured":true}' \
    run_infra deploy-dashboard.sh --topology vlan
  assert_eq "$RC" 0 "$(tail -5 <<<"$OUT")"
  assert_no_match "$(grep -E '^(curl|ssh|scp) ' "$FAKE_LOG")" "10\.99\.(10|20)\."
}

# ---- cleanup --switch, node --net ------------------------------------------------------------
test_m7_cleanup_switch_and_node_net() {
  _prepare_kvm_run_sandbox   # resource terlindungi + network default/int di virsh palsu
  echo running > "$FAKE_STATE/dom/pxe-test-switch"
  : > "$PXE_AGENT_DIR/vms/pxe-test-switch.qcow2"; : > "$PXE_AGENT_DIR/vms/pxe-test-switch-seed.iso"
  : > "$PXE_AGENT_DIR/vms/pxe-test-switch-base.qcow2"
  run_infra cleanup.sh m7vlancore
  assert_eq "$RC" 0 "$OUT"
  assert_file "$FAKE_STATE/dom/pxe-test-switch"   # tanpa --switch tidak disentuh
  assert_file "$PXE_AGENT_DIR/vms/pxe-test-switch.qcow2"
  run_infra cleanup.sh m7vlancore --switch
  assert_eq "$RC" 0 "$OUT"
  assert_no_file "$FAKE_STATE/dom/pxe-test-switch"
  assert_no_file "$PXE_AGENT_DIR/vms/pxe-test-switch.qcow2"
  assert_no_file "$PXE_AGENT_DIR/vms/pxe-test-switch-seed.iso"
  assert_file "$PXE_AGENT_DIR/vms/pxe-test-switch-base.qcow2"
  local r
  for r in switchx switch trunk1 port2; do
    : > "$FAKE_LOG"
    run_infra cleanup.sh "$r"
    assert_ne "$RC" 0 "run id $r"
    assert_empty "$(mutating_calls)"
  done
  # node.sh --net: allowlist.
  export INFRA_DRY_RUN=1
  run_infra node.sh create pxe-test-m7x-node31 52:54:00:99:00:31 uefi --net pxe-test-port1
  assert_eq "$RC" 0 "$OUT"
  assert_match "$(unq "$OUT")" "virt-install .*--network network=pxe-test-port1,mac=52:54:00:99:00:31,"
  for r in default int pxe-test-trunk pxe-test-nat; do
    run_infra node.sh create pxe-test-m7x-node31 52:54:00:99:00:31 uefi --net "$r"
    assert_ne "$RC" 0 "--net $r"
    assert_no_match "$OUT" "DRY-RUN"
  done
}

# ---- AC-7.17 ---------------------------------------------------------------------------------
test_m7_relay() {
  local R="$INFRA_DIR_UNDER_TEST/vlan/relay.sh" root="$SB/relayroot" m ip
  mkdir -p "$root"
  export PXE_RELAY_ROOT="$root"
  for m in "" evil "rm -rf" shell; do
    : > "$FAKE_LOG"
    set +e; OUT="$(MODE="$m" NODE_IP=10.99.20.41 NODE_USER=m7admin bash "$R" 2>&1)"; RC=$?; set -e
    assert_eq "$RC" 2 "MODE '$m'"
    assert_empty "$(grep -E '^(ssh|scp) ' "$FAKE_LOG" || true)"
  done
  for ip in 10.99.0.41 10.99.10.41 192.168.1.5 10.99.20.0 10.99.20.255 "10.99.20.41;id" ""; do
    for m in verify pwcheck wait-ssh reboot probe; do
      : > "$FAKE_LOG"
      set +e; OUT="$(MODE="$m" NODE_IP="$ip" NODE_USER=m7admin bash "$R" 2>&1)"; RC=$?; set -e
      assert_eq "$RC" 2 "$m NODE_IP '$ip'"
      assert_empty "$(grep -E '^(ssh|scp) ' "$FAKE_LOG" || true)"
    done
  done
  set +e; OUT="$(MODE=capture-start CAP_IF=nat0 bash "$R" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 2 "CAP_IF nat0"
  set +e; OUT="$(PXE_RELAY_ROOT=/tmp/evil MODE=setup bash "$R" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 2 "PXE_RELAY_ROOT di luar sandbox"
  # setup -> key (0600) -> status tanpa isi -> verify memanggil ssh ke node -> teardown bersih.
  set +e; OUT="$(MODE=setup bash "$R" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$OUT"; assert_eq "$(stat -c %a "$root/pxe-relay")" 700
  local secret="KEYMATERIAL-$RANDOM-$RANDOM"
  (umask 077 && echo "$secret" > "$root/pxe-relay/node_ed25519")
  echo 'echo verify' > "$root/pxe-relay/verify-node.sh"
  set +e; OUT="$(MODE=status bash "$R" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$OUT"; assert_contains "$OUT" "relay-key: 600"; assert_not_contains "$OUT" "$secret"
  : > "$FAKE_LOG"
  set +e; OUT="$(MODE=verify NODE_IP=10.99.20.41 NODE_USER=m7admin EXPECT_VLAN=20 EXPECT_PUBKEY='ssh-ed25519 AAAA x' bash "$R" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$OUT"
  assert_match "$(cat "$FAKE_LOG")" "^ssh -i $root/pxe-relay/node_ed25519 .* m7admin@10\.99\.20\.41 EXPECT_PUBKEY=.* EXPECT_VLAN=20 bash -s$"
  assert_not_contains "$OUT$(cat "$FAKE_LOG")" "$secret"
  chmod 644 "$root/pxe-relay/node_ed25519"
  set +e; OUT="$(MODE=status bash "$R" 2>&1)"; RC=$?; set -e
  assert_ne "$RC" 0 "key bukan 0600 harus gagal"
  set +e; OUT="$(MODE=teardown bash "$R" 2>&1)"; RC=$?; set -e
  assert_eq "$RC" 0 "$OUT"; assert_contains "$OUT" "relay-clean: absent"
  assert_no_file "$root/pxe-relay"
}

test_m7_host_never_targets_vlan_subnets() {
  # Host tidak punya route ke 10.99.10.0/24 / 10.99.20.0/24: ssh/scp/curl/wget/page.goto dari script
  # HOST ke alamat itu akan keluar lewat LAN fisik. Pengecualian: file yang berjalan DI DALAM VM
  # (infra/vlan/relay.sh, infra/server/**, infra/switch/**, verify-node.sh).
  local f hits=""
  for f in "$INFRA_DIR_UNDER_TEST"/*.sh "$REPO_UNDER_TEST"/dashboard/e2e-kvm/*.ts; do
    [[ "$(basename "$f")" == verify-node.sh ]] && continue
    hits+="$(grep -nE '(\b(ssh|scp|curl|wget)\b|page\.goto|request\.(get|post)|fetch\().*10\.99\.(10|20)\.' "$f" | sed "s#^#$f:#" || true)"
    # Baris komentar dan pola `grep -q… '<teks bukti>'` (mencocokkan keluaran relay, bukan koneksi) dikecualikan.
    hits+="$(grep -nE '@10\.99\.(10|20)\.|https?://10\.99\.(10|20)\.' "$f" | grep -vE '^[0-9]+:\s*(#|//|\*)' \
      | grep -vE "^[0-9]+:.*grep -[a-zA-Z]*q[a-zA-Z]* '[^']*10\.99\.(10|20)\." | sed "s#^#$f:#" || true)"
  done
  assert_empty "$hits" "script host menyasar 10.99.10.*/10.99.20.*"
  # Dinamis: rencana dry-run semua skenario VLAN hanya ssh/scp ke 10.99.0.2/.3 dan curl ke 10.99.0.2.
  _m7_vlan_sandbox
  export INFRA_DRY_RUN=1
  local s targets
  for s in vlansmoke vlanneg vlancore vlandistro; do
    rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
    run_infra kvm-run.sh m7 --scenario "$s"
    assert_eq "$RC" 0 "$s: $(tail -5 <<<"$OUT")"
    targets="$(unq "$OUT" | grep -E '^DRY-RUN: (ssh|scp) ' | grep -oE '[a-z0-9_]+@[0-9.]+' | sed 's/.*@//' | sort -u | tr '\n' ' ')"
    [[ "$targets" == "10.99.0.2 10.99.0.3 " ]] || _fail "$s: target ssh/scp '$targets'"
    assert_no_match "$(grep -E '^(ssh|scp|curl) ' "$FAKE_LOG" || true)" "@10\.99\.(10|20)\.|//10\.99\.(10|20)\."
    assert_empty "$(mutating_calls)" "$s dry-run mengeksekusi mutasi"
  done
}

# ---- AC-7.18 ---------------------------------------------------------------------------------
_m7_vn_fakes() { # ip palsu untuk verify-node.sh mode VLAN; `ip -d -o link show` dari $SB/links
  _m7_fake ip 'case "$*" in
    "-d -o link show") cat "$SB/links" ;;
    "-4 -o addr show dev "*) d="${*: -1}"; grep -E "^[0-9]+: $d " "$SB/addrs" || true ;;
    "-4 -o addr show") cat "$SB/addrs" ;;
    "-4 route show default") echo "default via 10.99.20.1 dev mgmt.20 proto static" ;;
  esac; exit 0'
  _m7_fake hostname 'echo m7-node31'
}
_m7_links() { # _m7_links <vlan-id> <link-parent-anak>
  printf '%s\n' '1: lo: <LOOPBACK,UP> mtu 65536 \    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00' \
    '2: enp1s0: <BROADCAST,UP> mtu 1500 \    link/ether 52:54:00:99:00:31 brd ff:ff:ff:ff:ff:ff' \
    '3: enp2s0: <BROADCAST,UP> mtu 1500 \    link/ether 52:54:00:99:00:99 brd ff:ff:ff:ff:ff:ff' \
    "4: mgmt.20@$2: <BROADCAST,UP> mtu 1500 \\    link/ether 52:54:00:99:00:31 brd ff:ff:ff:ff:ff:ff \\    vlan protocol 802.1Q id $1 <REORDER_HDR>" > "$SB/links"
}
_m7_vn_run() {
  set +e
  OUT="$(EXPECT_HOSTNAME=m7-node31 EXPECT_IP=10.99.20.41 EXPECT_PREFIX=24 EXPECT_MAC=52:54:00:99:00:31 EXPECT_GW=10.99.20.1 \
    EXPECT_DNS=10.99.10.2 EXPECT_USER=nobody EXPECT_PUBKEY='ssh-ed25519 AAAA x' EXPECT_VLAN=20 VERIFY_SCAN_ROOT="$SB/scan" \
    bash "$REPO_UNDER_TEST/dashboard/e2e-kvm/verify-node.sh" 2>&1)"
  RC=$?
  set -e
}
test_m7_verify_node_vlan() {
  _m7_vn_fakes; mkdir -p "$SB/scan"
  _m7_links 20 enp1s0; echo "4: mgmt.20    inet 10.99.20.41/24 brd 10.99.20.255 scope global mgmt.20" > "$SB/addrs"
  _m7_vn_run
  assert_contains "$OUT" "OK   parent NIC dengan MAC 52:54:00:99:00:31 (bukan VLAN) ditemukan (enp1s0)"
  assert_contains "$OUT" "OK   anak VLAN 802.1Q id 20 di enp1s0 ditemukan (mgmt.20)"
  assert_contains "$OUT" "OK   ip -4 addr mgmt.20 memuat 10.99.20.41/24"
  assert_contains "$OUT" "OK   parent enp1s0 tanpa IPv4"
  assert_contains "$OUT" "OK   tidak ada IPv4 di interface lain selain mgmt.20"
  assert_contains "$OUT" "OK   default via 10.99.20.1"
  # IP di parent (bukan anak) -> FAIL.
  echo "2: enp1s0    inet 10.99.20.41/24 brd 10.99.20.255 scope global enp1s0" > "$SB/addrs"
  _m7_vn_run
  assert_ne "$RC" 0; assert_contains "$OUT" "FAIL ip -4 addr mgmt.20 memuat 10.99.20.41/24"; assert_contains "$OUT" "FAIL parent enp1s0 tanpa IPv4"
  # Parent punya IPv4 tambahan (lease PXE) -> FAIL.
  printf '%s\n' "4: mgmt.20    inet 10.99.20.41/24 brd 10.99.20.255 scope global mgmt.20" "2: enp1s0    inet 10.99.10.150/24 brd 10.99.10.255 scope global dynamic enp1s0" > "$SB/addrs"
  _m7_vn_run
  assert_ne "$RC" 0; assert_contains "$OUT" "FAIL parent enp1s0 tanpa IPv4"
  # VLAN id salah (30) -> FAIL; anak di parent lain -> FAIL.
  echo "4: mgmt.20    inet 10.99.20.41/24 brd 10.99.20.255 scope global mgmt.20" > "$SB/addrs"
  _m7_links 30 enp1s0; _m7_vn_run
  assert_ne "$RC" 0; assert_contains "$OUT" "FAIL anak VLAN 802.1Q id 20 di enp1s0 ditemukan (tidak ada)"
  _m7_links 20 enp2s0; _m7_vn_run
  assert_ne "$RC" 0; assert_contains "$OUT" "FAIL anak VLAN 802.1Q id 20 di enp1s0 ditemukan (tidak ada)"
}

# ---- AC-7.19 ---------------------------------------------------------------------------------
test_m7_kvm_run_vlan_scenarios() {
  _m7_vlan_sandbox
  export INFRA_DRY_RUN=1
  local s o r
  run_infra kvm-run.sh m7 --scenario vlancore
  assert_eq "$RC" 0 "$(tail -5 <<<"$OUT")"
  o="$(unq "$OUT")"
  assert_match "$o" "PXE_KVM_NODES=pxe-test-m7vlancore-node31=52:54:00:99:00:31=uefi=10\.99\.20\.41=ubuntu=install=m7-node31 pxe-test-m7vlancore-node32=52:54:00:99:00:32=bios=10\.99\.20\.42=ubuntu=install=m7-node32 "
  assert_match "$o" "virt-install .*--name pxe-test-m7vlancore-node31 .*--network network=pxe-test-port1,mac=52:54:00:99:00:31,"
  assert_match "$o" "PXE_KVM_GATEWAY=10\.99\.20\.1 PXE_KVM_DNS=10\.99\.10\.2 PXE_KVM_PREFIX=24 "
  assert_match "$o" "PXE_KVM_TOPOLOGY=vlan PXE_KVM_VLAN=20 PXE_KVM_INFRA_KEY=.*/keys/infra_ed25519 PXE_KVM_RELAY_CMD=.*/infra/vlan/relay\.sh "
  assert_match "$o" "PXE_KVM_BASE_URL=http://10\.99\.0\.2 "
  assert_match "$o" "root@10\.99\.0\.2 MODE=verify NODE_IP=10\.99\.20\.41 .*EXPECT_GW=10\.99\.20\.1 EXPECT_DNS=10\.99\.10\.2 .*EXPECT_VLAN=20 bash -s"
  # Urutan tahap: server-up -> deploy -> switch-up -> server-check -> relay-setup -> node.
  local seq; seq="$(grep -oE '^[0-9TZ:-]+ (server-up|deploy|switch-up|server-check|relay-setup|node-create|playwright|relay-teardown|cleanup) ' "$PXE_RUNS_DIR/vlancore/kvm-run.txt" | awk '{print $2}' | uniq | tr '\n' ' ')"
  assert_eq "$seq" "server-up deploy switch-up server-check relay-setup node-create playwright relay-teardown cleanup "
  r="$PXE_RUNS_DIR/vlancore/results.json"
  assert_eq "$(_m7_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["switchStopped"]')" True
  assert_eq "$(_m7_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["relayClean"]')" True
  assert_eq "$(_m7_json "$PXE_RUNS_DIR/results.json" 'sorted(d["runs"].keys())')" "['vlancore']"
  # Default node + run id + dir bukti per skenario.
  run_infra kvm-run.sh m7 --scenario vlandistro
  assert_match "$(unq "$OUT")" "pxe-test-m7vlandistro-node33=52:54:00:99:00:33=uefi=10\.99\.20\.43=debian=install=m7-node33 pxe-test-m7vlandistro-node34=52:54:00:99:00:34=uefi=10\.99\.20\.44=rocky=install"
  run_infra kvm-run.sh m7 --scenario vlansmoke
  assert_eq "$RC" 0
  assert_file "$PXE_RUNS_DIR/smoke/kvm-run.txt"
  assert_match "$(unq "$OUT")" "pxe-test-m7vlansmoke-node41=52:54:00:99:00:41=uefi=10\.99\.20\.51=ubuntu=install=m7-node41 pxe-test-m7vlansmoke-node42=.*=rocky=install=m7-node42 pxe-test-m7vlansmoke-node43=.*=debian=install=m7-node43"
  run_infra kvm-run.sh m7 --scenario vlanneg
  assert_eq "$RC" 0 "$(tail -5 <<<"$OUT")"
  o="$(unq "$OUT")"
  assert_match "$o" "virt-install .*--name pxe-test-m7vlanneg-node36 .*--network network=pxe-test,mac=52:54:00:99:00:36,"
  assert_match "$o" "virt-install .*--name pxe-test-m7vlanneg-node37 .*--network network=pxe-test-port2,mac=52:54:00:99:00:37,"
  assert_match "$o" "virt-install .*--name pxe-test-m7vlanneg-node38 .*--network network=pxe-test-port2,mac=52:54:00:99:00:38,"
  assert_match "$o" "MODE=capture-start CAP_IF=pxe0 bash -s"
  assert_match "$o" "root@10\.99\.0\.3 /usr/local/sbin/pxe-switch\.sh apply-port sw-p2 tagged10"
  # Setelah N3 profil kembali access20.
  assert_eq "$(grep -oE 'apply-port sw-p2 [a-z0-9]+' <<<"$o" | tail -1)" "apply-port sw-p2 access20"
  r="$PXE_RUNS_DIR/vlanneg/results.json"
  assert_eq "$(_m7_json "$r" '[e["ac"] for e in d["results"] if e["ac"].startswith("AC-7.2")]')" "['AC-7.26', 'AC-7.27', 'AC-7.28']"
  assert_eq "$(_m7_json "$r" 'len([e for e in d["results"] if e["ac"]=="verify-node"])')" 0
  # :neg= hanya di vlanneg; vlanneg wajib :neg=.
  for s in "--scenario vlancore --nodes 31:uefi:neg=admin" "--nodes 31:uefi:neg=admin" "--scenario vlanneg --nodes 36:uefi" "--scenario vlanneg --nodes 36:uefi:neg=bogus" "--scenario vlanneg --waves"; do
    : > "$FAKE_LOG"
    set +e; OUT="$(eval "bash '$INFRA_DIR_UNDER_TEST/kvm-run.sh' m7 $s" </dev/null 2>&1)"; RC=$?; set -e
    assert_ne "$RC" 0 "kvm-run m7 $s"
    assert_no_match "$OUT" "DRY-RUN: virt-install"
  done
}

test_m7_kvm_run_vlan_max_nodes() {
  _m7_vlan_sandbox
  export INFRA_DRY_RUN=1
  local mem exp
  for mem in "10240 1" "12288 2" "16384 3"; do
    set -- $mem
    rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
    PXE_KVM_MEMINFO="$(_m7_meminfo "$1")" run_infra kvm-run.sh m7 --scenario vlancore --nodes "31:uefi"
    assert_eq "$RC" 0 "$(tail -3 <<<"$OUT")"
    assert_match "$OUT" "preflight +ok max_nodes=$2 "
  done
  # Switch sudah berjalan -> RAM switch tidak dikurangkan lagi (12288 - 3072 - 4096 = 5120 -> 2).
  echo running > "$FAKE_STATE/dom/pxe-test-switch"
  PXE_KVM_MEMINFO="$(_m7_meminfo 11400)" run_infra kvm-run.sh m7 --scenario vlancore --nodes "31:uefi"
  assert_match "$OUT" "preflight +ok max_nodes=2 "
}

test_m7_kvm_run_vlan_fail_stages() {
  _m7_vlan_sandbox
  export INFRA_DRY_RUN=1
  local st r o
  for st in switch-up server-check relay-setup nodes playwright verify; do
    rm -rf "$PXE_RUNS_DIR"; mkdir -p "$PXE_RUNS_DIR"
    PXE_KVM_DRY_FAIL_AT="$st" run_infra kvm-run.sh m7 --scenario vlancore
    assert_ne "$RC" 0 "gagal di $st"
    r="$PXE_RUNS_DIR/vlancore/results.json"
    assert_eq "$(_m7_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["failedStage"]')" "$st"
    assert_eq "$(_m7_json "$r" '[e for e in d["results"] if e["ac"]=="cleanup"][0]["relayClean"]')" True
    o="$(unq "$OUT")"
    # Relay teardown dipanggil bila relay sudah disiapkan (tahap setelah relay-setup), sebelum server dimatikan.
    case "$st" in
      switch-up|server-check|relay-setup)
        # relay-setup: simulasi gagal di AWAL tahap (sebelum direktori/key dibuat) -> tidak ada yang dibersihkan.
        assert_no_match "$o" "MODE=teardown" "$st: relay belum disiapkan" ;;
      *)
        assert_match "$o" "root@10\.99\.0\.2 MODE=teardown bash -s"
        local lt ls
        lt="$(grep -n 'MODE=teardown' <<<"$o" | head -1 | cut -d: -f1)"
        ls="$(grep -n 'pxe-test-server dimatikan' <<<"$o" | head -1 | cut -d: -f1)"
        [[ -n "$ls" ]] && ((lt < ls)) || _fail "$st: teardown relay ($lt) harus sebelum server dimatikan (${ls:-?})" ;;
    esac
    # Switch dimatikan bila sudah dibuat (setelah tahap switch-up dimulai).
    if [[ "$st" == switch-up ]]; then assert_no_match "$o" "pxe-test-switch dimatikan"
    else assert_match "$o" "pxe-test-switch dimatikan dan di-undefine"; fi
    assert_no_file "$PXE_AGENT_DIR/keys/m7vlancore-admin.pass"
  done
}

test_m7_server_base_reprovision_fixes() {
  # Bring-up M7 (base dihapus M6-T16): provisioning ulang base tidak boleh gagal karena
  # (a) nfs-server-generator menuntut mount ISO (/dev/sr2) yang tidak ada di VM base, dan
  # (b) seed sisa run gagal milik qemu tidak bisa ditimpa cloud-localds.
  assert_match "$(cat "$INFRA_DIR_UNDER_TEST/server/provision-root.sh")" "^systemctl restart nfs-server \|\| "
  local b="$INFRA_DIR_UNDER_TEST/server-base.sh" l_rm l_cl
  l_rm="$(grep -n 'run rm -f "\$BASE_SEED"' "$b" | head -1 | cut -d: -f1)"
  l_cl="$(grep -n 'run cloud-localds' "$b" | head -1 | cut -d: -f1)"
  [[ -n "$l_rm" && -n "$l_cl" ]] && ((l_rm < l_cl)) || _fail "seed base harus dihapus sebelum cloud-localds ($l_rm/$l_cl)"
  assert_match "$(cat "$b")" "packages: \[dnsmasq, nginx, nfs-kernel-server, nftables, tcpdump\]"
}

t "M7 XML network trunk/port1/port2 tanpa ip/forward/dhcp (AC-7.14)"          test_m7_net_xml
t "M7 net-up/net-down --topology vlan, idempoten, flat tetap (AC-7.14)"        test_m7_net_up_down_vlan
t "M7 net-up menolak XML berisi ip/forward/dhcp/nama salah (AC-7.14)"          test_m7_net_up_rejects_bad_xml
t "M7 switch-up dry-run: overlay/seed, 4 NIC, RAM<=1024, tanpa NAT (AC-7.15)"   test_m7_switch_up_dry
t "M7 pxe-switch.sh apply/apply-port: perintah tabel §2.2 (AC-7.15)"           test_m7_pxe_switch_apply
t "M7 pxe-switch.sh verify PASS/FAIL (AC-7.15)"                                test_m7_pxe_switch_verify
t "M7 profil server VLAN statis: dnsmasq/nginx/NFS/sysctl (AC-7.16)"            test_m7_server_profile_static
t "M7 verify-listen-vlan.sh: PASS / FAIL + stop dnsmasq (AC-7.16)"            test_m7_verify_listen_vlan
t "M7 server-up --topology vlan dry-run (NIC trunk, urutan profil) (AC-7.16)"   test_m7_server_up_vlan_dry
t "M7 deploy-dashboard --topology vlan: env + asersi vlanNetworks (AC-7.16)"   test_m7_deploy_vlan
t "M7 cleanup.sh --switch, run id switch* ditolak, node.sh --net (AC-7.19)"    test_m7_cleanup_switch_and_node_net
t "M7 relay.sh: mode/NODE_IP ditolak, key 0600 tidak dicetak (AC-7.17)"        test_m7_relay
t "M7 host tidak pernah menyasar 10.99.10.*/10.99.20.* (AC-7.17)"              test_m7_host_never_targets_vlan_subnets
t "M7 verify-node.sh EXPECT_VLAN OK/FAIL (AC-7.18)"                             test_m7_verify_node_vlan
t "M7 kvm-run skenario VLAN: run id, node, IP, network, neg (AC-7.19)"         test_m7_kvm_run_vlan_scenarios
t "M7 kvm-run max_nodes kurangi RAM server+switch (AC-7.19)"                   test_m7_kvm_run_vlan_max_nodes
t "M7 kvm-run gagal tiap tahap VLAN: cleanup, relay teardown, switch (AC-7.19)" test_m7_kvm_run_vlan_fail_stages
t "M7 server-base: provisioning ulang (nfs-server non-fatal, seed dihapus, tcpdump)" test_m7_server_base_reprovision_fixes
