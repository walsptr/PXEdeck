#!/usr/bin/env bash
# infra/redact-evidence.sh <dir>
# Samarkan secret pada SEMUA file bukti di <dir> (rekursif; mis. .agent/runs/<m>/kvm), lalu scan
# ulang. Exit 0 = bersih; exit 1 = masih ada temuan (daftar file:baris ke stderr, isi dipotong).
# Dipanggil kvm-run.sh setelah bukti terkumpul (console, log nginx, journal, Playwright) — AC-4.34.
#
# Yang disamarkan (in-place, byte-aman via sed -E, LC_ALL=C):
#   - token job pada path boot: /boot/<mac>/<token 43 char base64url>  -> /boot/<mac>/<REDACTED-TOKEN>
#     (MAC bisa berupa aa:bb:..., aa-bb-..., %3A-encoded, atau 12 hex)
#   - parameter token=<43 char> / "token":"<43 char>"                -> REDACTED-TOKEN
#   - hash SHA-512 crypt $6$[rounds=N$]salt$hash                      -> $6$REDACTED
# Yang hanya dipindai (tidak bisa disamarkan dengan aman -> gagal): header private key.
# Pola scan selaras dengan .agent/runs/m4/secret-scan.sh.
set -euo pipefail

[[ $# -eq 1 ]] || { echo "pakai: $0 <dir-bukti>" >&2; exit 2; }
dir="$1"
[[ -d "$dir" ]] || { echo "redact-evidence: direktori '$dir' tidak ada" >&2; exit 2; }

# Hanya grep/sed/find (GNU, LC_ALL=C agar byte-aman untuk log console mentah); tanpa perl/xargs
# karena test infra memakai PATH minimal.
export LC_ALL=C
B64U='[A-Za-z0-9_-]'
TOKEN_PATH_RE="/boot/[0-9a-fA-F:%-]{12,40}/$B64U{43}([^A-Za-z0-9_-]|\$)"
TOKEN_KV_RE="(token[\"']?[[:space:]]*[=:][[:space:]]*[\"']?)$B64U{43}([^A-Za-z0-9_-]|\$)"
HASH_RE='\$6\$(rounds=[0-9]+\$)?[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{20,}'
PKEY_RE='-----BEGIN [A-Z ]*PRIVATE KEY-----'

n=0
while IFS= read -r -d '' f; do
  n=$((n + 1))
  sed -E -i \
    -e "s#(/boot/[0-9a-fA-F:%-]{12,40}/)$B64U{43}([^A-Za-z0-9_-]|\$)#\1REDACTED-TOKEN\2#g" \
    -e "s#$TOKEN_KV_RE#\1REDACTED-TOKEN\2#gI" \
    -e "s#$HASH_RE#\$6\$REDACTED#g" \
    "$f"
done < <(find "$dir" -type f -print0)

hits="$(find "$dir" -type f -exec grep -EnaH -i -e "$TOKEN_PATH_RE" -e "$TOKEN_KV_RE" -e "$HASH_RE" -e "$PKEY_RE" {} + \
  | cut -d: -f1,2 | head -50 || true)"

if [[ -n "$hits" ]]; then
  echo "redact-evidence: TEMUAN secret setelah redaksi di $dir:" >&2
  echo "$hits" >&2
  exit 1
fi
echo "redact-evidence: $n file di $dir bersih (token/hash disamarkan)" >&2
