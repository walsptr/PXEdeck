#!/usr/bin/env bash
# M7 iter2 secret scan (test-engineer, gate iter2 M7, DEC-028 §2 pola URL ketat; turunan M6 + URL kredensial DEC-027 §4): (1) bukti .agent/runs/m7/** teks + base64 (semua
# file termasuk biner/PNG); (2) riwayat git 1a7be29..HEAD (setiap blob yang ditambah/diubah) teks +
# base64; (3) file diubah/untracked di working tree di luar .agent/runs. Pola: token 43 char di path
# /boot/, token=/"token":, hash $6$, hash scrypt lengkap, header private key, password dummy fixture,
# literal password admin run (bila .agent/keys/*-admin.pass ada; nilai tidak dicetak).
# Hit di file test/golden/fixture diklasifikasi "fixture" (nilai dummy/sintetis yang sengaja dipakai test).
set -uo pipefail
cd "$(dirname "$0")/../../../.."
S=.agent/runs/m7/final-iter2/b64-scan.py
export PXE_KEYS_GLOB="${PXE_KEYS_GLOB:-/home/syawal/Project/PXE-BOOT/.agent/keys/*-admin.pass}"
FIXTURE_RE='(\.test\.tsx?|/test/golden/|/test/fixtures\.ts|/test/installer-logs|/e2e/[^:]*\.spec\.ts|/e2e/m5-support\.ts|infra/test/)'
BASE="${1:-$(git merge-base main HEAD)}"
echo "# secret-scan M7 iter2 $(date -u +%FT%TZ) @ $(git rev-parse --short HEAD)"
classify() { # stdin = keluaran b64-scan (baris 1 = ringkasan)
  local all fx nf; all="$(cat)"
  head -1 <<<"$all"
  fx="$(tail -n +2 <<<"$all" | grep -E "$FIXTURE_RE" || true)"
  nf="$(tail -n +2 <<<"$all" | grep -Ev "$FIXTURE_RE" || true)"
  echo "fixture test/golden (dummy/sintetis, bukan secret): $(grep -c . <<<"$fx" || true) hit"; [[ -n "$fx" ]] && sed 's/^/  /' <<<"$fx"
  if [[ -n "$nf" ]]; then echo "TEMUAN di luar fixture:"; sed 's/^/  /' <<<"$nf"; else echo "bersih di luar fixture"; fi
}
echo "## (1) bukti .agent/runs/m7/** (teks + base64 UTF-8/UTF-16LE, offset 0-3, 2 lapis)"
python3 -I "$S" runs .agent/runs/m7 | classify
echo "## (2) riwayat git $BASE..HEAD ($(git rev-list --count "$BASE"..HEAD) commit)"
python3 -I "$S" git "$PWD" "$BASE"..HEAD | classify
echo "## (3) working tree: file diubah/untracked di luar .agent/runs"
( git diff --name-only HEAD; git ls-files --others --exclude-standard ) | sort -u | grep -v '^\.agent/runs/' | python3 -I "$S" files | classify
echo "## (4) repo: semua file ter-track di HEAD ($(git ls-files | wc -l) file; termasuk .agent/runs ter-commit)"
git ls-files | python3 -I "$S" files | classify
