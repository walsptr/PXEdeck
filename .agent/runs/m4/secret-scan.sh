#!/usr/bin/env bash
# Scan secret/password plaintext pada bukti .agent/runs/m4/** dan file yang diubah di commit ini.
set -uo pipefail
cd "$(dirname "$0")/../.."
R=.agent/runs/m4
echo "# secret-scan $(date -u +%FT%TZ) — target: $R/** (teks), file test/infra yang diubah branch ini"
echo "# pola: password dummy test, hash SHA-512 crypt, token 43 char pada path /boot/, header private key, AWS/GH token generik"
files=$(find "$R" -type f \( -name '*.txt' -o -name '*.log' -o -name '*.json' -o -name '*.md' \) ! -name secret-scan.txt | sort)
chk() { # chk <label> <regex>
  local hits; hits=$(grep -EnI -- "$2" $files 2>/dev/null | grep -v 'FIXTURE-token-not-real' | head -20)
  if [[ -n "$hits" ]]; then echo "TEMUAN $1:"; echo "$hits" | cut -c1-240; else echo "bersih  $1"; fi
}
chk "password dummy fixture (Fixture-Pass-7319)" 'Fixture-Pass-7319'
chk "hash SHA-512 crypt"                          '\$6\$[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{20,}'
chk "token pada path /boot/"                      '/boot/[0-9a-fA-F:%-]{12,40}/[A-Za-z0-9_-]{43}(/|$)'
chk "private key"                                 '-----BEGIN [A-Z ]*PRIVATE KEY-----'
chk "token API generik"                           '(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36})'
echo "# file teks dipindai: $(wc -w <<<"$files")"
echo "# --- file kode/test yang diubah branch (git diff + untracked), di luar .agent/runs ---"
changed=$( (git diff --name-only main...HEAD; git diff --name-only; git ls-files --others --exclude-standard) | sort -u | grep -v '^\.agent/runs/' | while read -r f; do [[ -f "$f" ]] && echo "$f"; done)
hits=$(grep -EnI -- '-----BEGIN [A-Z ]*PRIVATE KEY-----|\$6\$pxelab\$' $changed 2>/dev/null | grep -v 'FAKE_PRIVATE_KEY\|BEGIN OPENSSH PRIVATE KEY-----\\nb3B\|LAB_HASH_SALT\|"\$6\$pxelab\$"\|\$6\$pxelab\$ di kode\|expect(.*\$6\$pxelab' | head -20)
if [[ -n "$hits" ]]; then echo "TEMUAN di kode:"; echo "$hits" | cut -c1-240; else echo "bersih  private key / hash lab di kode yang diubah"; fi
echo "# catatan: hash berformat \$6\$ di test/golden = FAKE_HASH '\$6\$fixturesalt\$AbCdEf…' (bukan turunan password apa pun); FAKE_PRIVATE_KEY = header saja (fixture M3)."
