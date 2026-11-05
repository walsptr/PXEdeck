# shellcheck shell=bash
# infra/lib.sh — helper bersama untuk script infra KVM (di-source, bukan dieksekusi).
#
# Batas keras (CLAUDE.md): tanpa sudo; resource libvirt hanya berprefix pxe-test-;
# pxe-test-node01, ubuntu24.04, default, int milik user dan tidak pernah disentuh;
# disk VM hanya di .agent/vms/; ssh hanya ke 10.99.0.* dengan key di .agent/keys/.
#
# Env:
#   INFRA_DRY_RUN=1   cetak perintah yang mengubah state (virsh/virt-install/qemu-img/ssh...)
#                     tanpa mengeksekusinya.
#   PXE_AGENT_DIR     direktori .agent berisi media/vms/keys (default: .agent di checkout
#                     utama git, sehingga worktree memakai media yang sama).
#   PXE_RUN           nama run/milestone untuk bukti (default m4).
#   PXE_RUNS_DIR      direktori bukti (default <repo>/.agent/runs/<run>/kvm).

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$INFRA_DIR/.." && pwd)"

_default_agent_dir() {
  local common
  if common="$(git -C "$REPO_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
    echo "$(dirname "$common")/.agent"
  else
    echo "$REPO_DIR/.agent"
  fi
}

AGENT_DIR="${PXE_AGENT_DIR:-$(_default_agent_dir)}"
MEDIA_DIR="$AGENT_DIR/media"
VMS_DIR="$AGENT_DIR/vms"
KEYS_DIR="$AGENT_DIR/keys"
PXE_RUN="${PXE_RUN:-m4}"
RUNS_DIR="${PXE_RUNS_DIR:-$REPO_DIR/.agent/runs/$PXE_RUN/kvm}"

VIRSH_URI="qemu:///system"
NET_PXE="pxe-test"
NET_NAT="pxe-test-nat"
SERVER_NAME="pxe-test-server"
SERVER_IP="10.99.0.2"
SERVER_MAC_PXE="52:54:00:99:01:02"
SERVER_MAC_NAT="52:54:00:99:01:03"
SERVER_USER="pxe"
SSH_KEY="$KEYS_DIR/infra_ed25519"
SERVER_BASE="$VMS_DIR/pxe-test-server-base.qcow2"
SERVER_DISK="$VMS_DIR/pxe-test-server.qcow2"
SERVER_SEED="$VMS_DIR/pxe-test-server-seed.iso"
CLOUD_IMG="$MEDIA_DIR/ubuntu-24.04-server-cloudimg-amd64.img"
OVMF_CODE="/usr/share/edk2/ovmf/OVMF_CODE.fd"
OVMF_VARS="/usr/share/edk2/ovmf/OVMF_VARS.fd"

PROTECTED_NAMES=(pxe-test-node01 ubuntu24.04 default int)

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

is_dry() { [[ "${INFRA_DRY_RUN:-0}" == "1" ]]; }

# run <cmd...>: eksekusi perintah yang mengubah state; di dry-run hanya dicetak.
run() {
  if is_dry; then
    printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}

virsh_q() { virsh -c "$VIRSH_URI" "$@"; }   # baca saja
virsh_m() { run virsh -c "$VIRSH_URI" "$@"; } # mutasi

# assert_name <name>: harus ^pxe-test-, bukan nama terlindungi.
assert_name() {
  local n="$1" p
  for p in "${PROTECTED_NAMES[@]}"; do
    [[ "$n" == "$p" ]] && die "nama '$n' milik user dan dilindungi"
  done
  [[ "$n" == "pxe-test" || "$n" =~ ^pxe-test-[a-z0-9][a-z0-9-]*$ ]] || die "nama '$n' harus berprefix pxe-test- (huruf kecil/angka/-)"
}

# assert_path_in_vms <path>: path (boleh belum ada) harus di dalam $VMS_DIR.
assert_path_in_vms() {
  local p dir
  p="$1"
  dir="$(cd "$(dirname "$p")" 2>/dev/null && pwd -P)" || die "direktori '$p' tidak ada"
  local vms
  vms="$(cd "$VMS_DIR" && pwd -P)"
  [[ "$dir" == "$vms" ]] || die "path '$p' di luar $VMS_DIR"
  [[ "$(basename "$p")" == pxe-test-* ]] || die "nama file '$p' harus berprefix pxe-test-"
}

assert_mac() {
  [[ "$1" =~ ^52:54:00:99:0[0-9a-f]:[0-9a-f]{2}$ ]] || die "MAC '$1' harus 52:54:00:99:0X:NN"
}

dom_exists() { virsh_q dominfo "$1" >/dev/null 2>&1; }
dom_running() { [[ "$(virsh_q domstate "$1" 2>/dev/null)" == "running" ]]; }
net_exists() { virsh_q net-info "$1" >/dev/null 2>&1; }
net_active() { local o; o="$(virsh_q net-info "$1" 2>/dev/null)" || return 1; [[ "$o" =~ Active:[[:space:]]+yes ]]; }

ensure_dirs() { mkdir -p "$RUNS_DIR" "$VMS_DIR" "$KEYS_DIR"; }

# Key ed25519 sekali pakai untuk akses VM server.
ensure_key() {
  if [[ ! -f "$SSH_KEY" ]]; then
    log "membuat key $SSH_KEY"
    run ssh-keygen -q -t ed25519 -N '' -C "pxe-test-infra" -f "$SSH_KEY"
  fi
}

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
  -o LogLevel=ERROR -o ConnectTimeout=5 -o BatchMode=yes)

# ssh_server <args...>: ssh ke VM server (hanya 10.99.0.2) sebagai user tak-berhak `pxe`.
ssh_server() { run ssh "${SSH_OPTS[@]}" "$SERVER_USER@$SERVER_IP" "$@"; }
# ssh_root <args...>: operasi admin DI DALAM VM pxe-test-server (bukan host) via login root
# key-only ke VM uji itu sendiri — tanpa sudo di mana pun.
ssh_root() { run ssh "${SSH_OPTS[@]}" "root@$SERVER_IP" "$@"; }
scp_server() { # scp_server <src...> <remote-dest>
  local dest="${*: -1}" srcs=("${@:1:$#-1}")
  run scp "${SSH_OPTS[@]}" "${srcs[@]}" "$SERVER_USER@$SERVER_IP:$dest"
}

wait_ssh() { # wait_ssh <timeout-s>
  local t="${1:-300}" i=0
  is_dry && return 0
  until ssh "${SSH_OPTS[@]}" "$SERVER_USER@$SERVER_IP" true 2>/dev/null; do
    i=$((i + 5)); ((i >= t)) && return 1
    sleep 5
  done
}

# Serial console VM: libvirt (qemu:///system) membuat file serial milik root 0600 yang tidak
# terbaca tanpa sudo. Karena itu VM memakai chardev TCP mode=connect ke listener socat milik
# user di 127.0.0.1:<port> yang menulis ke file log (terbaca, tanpa root).
# serial_capture_start <port> <file> -> mencetak argumen --serial untuk virt-install.
serial_capture_start() {
  local port="$1" file="$2" pidf="$RUNS_DIR/.capture-$1.pid"
  serial_capture_stop "$port"
  is_dry || : > "$file"
  if ! is_dry; then
    nohup socat -u "TCP-LISTEN:$port,bind=127.0.0.1,reuseaddr" "OPEN:$file,creat,append" >/dev/null 2>&1 &
    echo $! > "$pidf"
    for _ in $(seq 1 20); do ss -ltnH "sport = :$port" | grep -q . && break; sleep 0.2; done
  fi
  echo "tcp,host=127.0.0.1:$port,mode=connect,protocol.type=raw"
}
serial_capture_stop() {
  local pidf="$RUNS_DIR/.capture-$1.pid"
  if [[ -f "$pidf" ]]; then kill "$(cat "$pidf")" 2>/dev/null || true; rm -f "$pidf"; fi
}
# Port serial per MAC 52:54:00:99:0X:NN -> 45000 + X*256 + NN.
serial_port_for_mac() { local a="${1:12:2}" b="${1:15:2}"; echo $((45000 + 16#$a * 256 + 16#$b)); }
