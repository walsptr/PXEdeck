# shellcheck shell=bash
# infra/test/harness.sh — harness test shell infra (M4-T12, AC-4.28). Di-source oleh run.sh.
#
# Keamanan (CLAUDE.md batas keras): test TIDAK PERNAH memanggil libvirt/ssh/curl sungguhan.
#  - PATH test = fake-bin/ (virsh, virt-install, qemu-img, ssh, scp, ssh-keygen, socat, curl, npm,
#    npx, cloud-localds palsu) + safe-bin/ (symlink HANYA ke utilitas dasar: bash, coreutils, grep,
#    sed, awk, ...). Biner asli virsh/virt-install/qemu-img/ssh tidak ada di PATH sama sekali,
#    sehingga kebocoran berakhir "command not found", bukan perintah sungguhan.
#  - Semua state (.agent/media|vms|keys, bukti runs, TMPDIR) di sandbox di dalam project
#    (`.agent/tmp/infra-test/sandbox.*`, gitignored) dan dihapus setelah tiap test.

INFRA_TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR_UNDER_TEST="$(cd "$INFRA_TEST_DIR/.." && pwd)"
REPO_UNDER_TEST="$(cd "$INFRA_DIR_UNDER_TEST/.." && pwd)"
SANDBOX_PARENT="${INFRA_TEST_SANDBOX_PARENT:-$REPO_UNDER_TEST/.agent/tmp/infra-test}"

SAFE_TOOLS=(bash sh env grep sed awk cat mkdir rm cp mv date dirname basename seq tr mktemp ls tee
  sleep find tar base64 sha256sum cut du head tail wc chmod touch xz nohup sort uniq readlink realpath
  id stat true false printf git ln diff cmp python3)

PASS=0; FAIL=0; FAILED_TESTS=()

_build_safe_bin() {
  SAFE_BIN="$SANDBOX_PARENT/safe-bin"
  rm -rf "$SAFE_BIN"; mkdir -p "$SAFE_BIN"
  local t p
  for t in "${SAFE_TOOLS[@]}"; do
    p="$(PATH=/usr/bin:/bin command -v "$t" 2>/dev/null)" || continue
    [[ "$p" == /* ]] && ln -s "$p" "$SAFE_BIN/$t"
  done
  # ss (dipakai serial_capture_start non-dry) sengaja TIDAK disediakan.
}

# new_sandbox: siapkan sandbox + env untuk satu test.
new_sandbox() {
  mkdir -p "$SANDBOX_PARENT"
  SB="$(mktemp -d "$SANDBOX_PARENT/sandbox.XXXXXX")"
  export FAKE_LOG="$SB/fake.log" FAKE_STATE="$SB/state"
  mkdir -p "$FAKE_STATE/dom" "$FAKE_STATE/net" "$SB/agent/media/ipxe" "$SB/agent/vms" "$SB/agent/keys" "$SB/runs" "$SB/tmp"
  : > "$FAKE_LOG"
  export PXE_AGENT_DIR="$SB/agent" PXE_RUNS_DIR="$SB/runs" TMPDIR="$SB/tmp" PXE_RUN=m4
  export PATH="$INFRA_TEST_DIR/fake-bin:$SAFE_BIN"
  export HOME="$SB/home"; mkdir -p "$HOME"
  unset INFRA_DRY_RUN
}

drop_sandbox() { [[ -n "${SB:-}" && "$SB" == "$SANDBOX_PARENT"/sandbox.* ]] && rm -rf "$SB"; SB=""; }

# Jalankan script infra; stdout+stderr → $OUT, exit code → $RC. stdin selalu /dev/null.
run_infra() {
  local script="$1"; shift
  set +e
  OUT="$(bash "$INFRA_DIR_UNDER_TEST/$script" "$@" </dev/null 2>&1)"
  RC=$?
  set -e
}

# Pemanggilan perintah palsu yang MENGUBAH state (bukan baca).
mutating_calls() {
  grep -E '^(virsh .*( net-define | net-start | net-destroy | net-undefine | start | destroy | shutdown | undefine | reset )|virt-install |qemu-img (create|convert|resize)|ssh |scp |ssh-keygen |socat |curl |npm |npx |cloud-localds )' "$FAKE_LOG" || true
}

# ---- assert ----
_fail() { echo "    ASSERT: $*" >&2; return 1; }
assert_eq() { [[ "$1" == "$2" ]] || _fail "${3:-} expected '$2' got '$1'"; }
assert_ne() { [[ "$1" != "$2" ]] || _fail "${3:-} expected not '$2'"; }
assert_contains() { [[ "$1" == *"$2"* ]] || _fail "${3:-} output tidak memuat: $2"; }
assert_not_contains() { [[ "$1" != *"$2"* ]] || _fail "${3:-} output memuat: $2"; }
assert_match() { grep -Eq -- "$2" <<<"$1" || _fail "${3:-} tidak cocok regex: $2"; }
assert_no_match() { ! grep -Eq -- "$2" <<<"$1" || _fail "${3:-} cocok regex terlarang: $2 → $(grep -E -- "$2" <<<"$1" | head -3)"; }
assert_empty() { [[ -z "$1" ]] || _fail "${2:-} harus kosong, berisi: $(head -5 <<<"$1")"; }
assert_file() { [[ -e "$1" ]] || _fail "file $1 tidak ada"; }
assert_no_file() { [[ ! -e "$1" ]] || _fail "file $1 masih ada"; }

# t <nama> <fungsi>: jalankan satu test di subshell dengan sandbox baru.
t() {
  local name="$1" fn="$2" rc
  set +e
  ( set -e; new_sandbox; trap drop_sandbox EXIT; "$fn" )
  rc=$?
  set -e
  if ((rc == 0)); then PASS=$((PASS + 1)); echo "  ok   $name"
  else FAIL=$((FAIL + 1)); FAILED_TESTS+=("$name"); echo "  FAIL $name"; fi
}
