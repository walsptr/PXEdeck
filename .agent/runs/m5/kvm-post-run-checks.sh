#!/usr/bin/env bash
# AC-5.43 (test-engineer, M5-T15): pemeriksaan SETELAH infra/kvm-run.sh selesai (cleanup trap sudah
# jalan). Hanya baca (virsh list/dominfo/net-list, ls), tanpa mutasi. Hasil → kvm/post-run-checks.txt
# + entri "AC-5.43" di kvm/results.json.
set -uo pipefail
cd "$(dirname "$0")/../../.."
R=.agent/runs/m5/kvm
MAIN_AGENT="$(git rev-parse --git-common-dir)/../.agent"
V="$MAIN_AGENT/vms"; K="$MAIN_AGENT/keys"
out="$R/post-run-checks.txt"; fail=0
ok() { echo "OK   $*" >> "$out"; }
bad() { echo "FAIL $*" >> "$out"; fail=1; }
{
  echo "# post-run checks $(date -u +%FT%TZ)"
  echo "# virsh -c qemu:///system list --all"; virsh -c qemu:///system list --all
  echo "# virsh -c qemu:///system net-list --all"; virsh -c qemu:///system net-list --all
  echo "# ls .agent/vms"; ls -1 "$V"
  echo "# ls .agent/keys"; ls -1 "$K"
} > "$out" 2>&1
doms="$(virsh -c qemu:///system list --all --name 2>/dev/null)"
grep -q '^pxe-test-m5-' <<<"$doms" && bad "VM pxe-test-m5-* masih ada" || ok "tidak ada VM pxe-test-m5-*"
grep -qx 'pxe-test-server' <<<"$doms" && bad "VM pxe-test-server masih ada" || ok "VM pxe-test-server sudah dimatikan & undefine"
ls "$V" | grep -q '^pxe-test-m5-' && bad "disk pxe-test-m5-* masih ada" || ok "tidak ada disk pxe-test-m5-*"
[[ -e "$V/pxe-test-server.qcow2" ]] && bad "overlay pxe-test-server.qcow2 masih ada" || ok "overlay server dihapus"
[[ -f "$V/pxe-test-server-base.qcow2" ]] && ok "base disk server tetap (CR-4-13)" || bad "base disk server hilang"
ls "$K" | grep -q 'pxe-test-m5-.*node_ed25519' && bad "key sekali pakai node masih ada" || ok "key sekali pakai node dihapus"
pgrep -af 'socat .*TCP-LISTEN:45' >/dev/null && bad "listener serial socat tersisa" || ok "tanpa listener serial socat tersisa"
# Resource terlindungi: identik dengan snapshot sebelum run (kvm-libvirt-before-run.txt).
before=".agent/runs/m5/kvm-libvirt-before-run.txt"
for n in ubuntu24.04 pxe-test-node01; do
  b="$(grep -E "^\s*[-0-9]+\s+$n\s" "$before" | awk '{$1=""; print}' | xargs)"
  a="$(virsh -c qemu:///system list --all | grep -E "^\s*[-0-9]+\s+$n\s" | awk '{$1=""; print}' | xargs)"
  [[ "$a" == "$b" ]] && ok "VM $n identik (sebelum='${b:-tidak ada}' sesudah='${a:-tidak ada}')" || bad "VM $n berubah (sebelum='$b' sesudah='$a')"
done
for n in default int pxe-test pxe-test-nat; do
  b="$(grep -E "^\s*$n\s" "$before" | xargs)"
  a="$(virsh -c qemu:///system net-list --all | grep -E "^\s*$n\s" | xargs)"
  [[ "$a" == "$b" ]] && ok "network $n identik ($a)" || bad "network $n berubah (sebelum='$b' sesudah='$a')"
done
# Scan bukti (teks + base64), juga ekspor log job.
ls "$R"/jobs-pxe-test-m5-node1{1,2}.json >/dev/null 2>&1 && ok "ekspor log job ada (jobs-*.json)" || bad "ekspor log job tidak ada"
scan="$(python3 -I .agent/runs/m5/b64-scan.py runs .agent/runs/m5 2>&1)"
echo "# b64-scan (teks+base64) .agent/runs/m5:" >> "$out"; echo "$scan" >> "$out"
[[ "$(head -1 <<<"$scan")" == *", 0 hit" ]] && ok "scan bukti bersih (teks+base64)" || bad "scan bukti menemukan pola secret"
grep -q '^bersih' "$R/evidence-scan.txt" 2>/dev/null && ok "scanEvidence harness bersih (password run, token, key)" || bad "scanEvidence harness tidak bersih/tidak ada"
grep -q 'redact *ok' "$R/kvm-run.txt" && ok "redact-evidence.sh ok di kvm-run" || bad "redact-evidence.sh tidak ok"
echo "# post-run exit=$fail" >> "$out"
python3 - "$R/results.json" "$fail" <<'PY'
import json, sys
p, fail = sys.argv[1], sys.argv[2] == "1"
j = json.load(open(p))
j["results"] = [r for r in j["results"] if r.get("ac") != "AC-5.43"]
j["results"].append({"ac": "AC-5.43", "status": "FAIL" if fail else "PASS", "note": "cleanup + resource terlindungi + key + scan bukti (post-run-checks.txt)", "evidence": ["post-run-checks.txt", "cleanup.txt", "evidence-scan.txt"]})
json.dump(j, open(p, "w"), indent=2); open(p, "a").write("\n")
PY
cat "$out"
exit "$fail"
