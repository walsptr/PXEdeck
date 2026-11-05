#!/usr/bin/env bash
# M5 secret scan (test-engineer): (1) bukti .agent/runs/m5/** teks + base64 (semua file, termasuk
# biner/PNG); (2) riwayat git main..HEAD (setiap blob yang ditambah/diubah commit branch) teks +
# base64; (3) file yang diubah/untracked di working tree di luar .agent/runs. Pola: token 43 char
# pada path /boot/, token=/"token":, hash SHA-512 crypt, header private key, password dummy fixture.
# Hit di file test/golden diklasifikasi "fixture" (nilai dummy yang sengaja dipakai test).
set -uo pipefail
cd "$(dirname "$0")/../../.."
S=.agent/runs/m5/b64-scan.py
FIXTURE_RE='(\.test\.tsx?|/test/golden/|/test/fixtures\.ts|/e2e/[^:]*\.spec\.ts|/e2e/m5-support\.ts|infra/test/)'
echo "# secret-scan M5 $(date -u +%FT%TZ) @ $(git rev-parse --short HEAD)"
echo "## (1) bukti .agent/runs/m5/** (teks + base64 UTF-8/UTF-16LE, offset 0-3, 2 lapis)"
python3 -I "$S" runs .agent/runs/m5
echo "## (2) riwayat git main..HEAD ($(git rev-list --count main..HEAD) commit)"
hist="$(python3 -I "$S" git "$PWD" main..HEAD)"
head -1 <<<"$hist"
fx="$(tail -n +2 <<<"$hist" | grep -E "$FIXTURE_RE" || true)"
nf="$(tail -n +2 <<<"$hist" | grep -Ev "$FIXTURE_RE" || true)"
echo "fixture test/golden (dummy, bukan secret): $(grep -c . <<<"$fx" || true) hit"; [[ -n "$fx" ]] && sed 's/^/  /' <<<"$fx"
if [[ -n "$nf" ]]; then echo "TEMUAN di luar fixture:"; sed 's/^/  /' <<<"$nf"; else echo "bersih di luar fixture"; fi
echo "## (3) working tree: file diubah/untracked di luar .agent/runs"
tmp="$(mktemp -d .agent/tmp-secret-scan.XXXXXX)"
( git diff --name-only HEAD; git ls-files --others --exclude-standard ) | sort -u | grep -v '^\.agent/runs/' | while read -r f; do [[ -f "$f" ]] && mkdir -p "$tmp/$(dirname "$f")" && cp "$f" "$tmp/$f"; done
wt="$(python3 -I "$S" runs "$tmp")"
rm -rf "$tmp"
head -1 <<<"$wt"
fx="$(tail -n +2 <<<"$wt" | grep -E "$FIXTURE_RE" || true)"; nf="$(tail -n +2 <<<"$wt" | grep -Ev "$FIXTURE_RE" || true)"
echo "fixture test (dummy): $(grep -c . <<<"$fx" || true) hit"; [[ -n "$fx" ]] && sed -e 's/^/  /' -e "s#$tmp/##" <<<"$fx"
if [[ -n "$nf" ]]; then echo "TEMUAN di luar fixture:"; sed 's/^/  /' <<<"$nf"; else echo "bersih di luar fixture"; fi
echo "## (4) infra/redact-evidence.sh .agent/runs/m5/kvm (scan ulang teks + biner)"
bash infra/redact-evidence.sh .agent/runs/m5/kvm 2>&1; echo "# exit=$?"
