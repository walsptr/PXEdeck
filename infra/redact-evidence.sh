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
#   - blob base64 (>= 40 char) yang ter-decode (UTF-8/UTF-16LE, offset 0-3, bertingkat hingga 3
#     lapis) memuat token path /boot/<mac>/<token>, hash $6$, atau "PRIVATE KEY"
#                                                                      -> REDACTED-B64-SECRET
#     (B-5: late-command `printf %s '<b64>' | base64 -d` dicetak installer ke console serial;
#     logika selaras .agent/runs/m4/b64-scan.py, diimplementasi dengan bash+base64+grep)
# Yang hanya dipindai (tidak bisa disamarkan dengan aman -> gagal): header private key.
# Pola scan selaras dengan .agent/runs/m4/secret-scan.sh.
set -euo pipefail

[[ $# -eq 1 ]] || { echo "pakai: $0 <dir-bukti>" >&2; exit 2; }
dir="$1"
[[ -d "$dir" ]] || { echo "redact-evidence: direktori '$dir' tidak ada" >&2; exit 2; }

# Hanya grep/sed/find/base64/tr/sort/awk (GNU, LC_ALL=C agar byte-aman untuk log console mentah);
# tanpa perl/xargs/python karena test infra memakai PATH minimal.
export LC_ALL=C
B64U='[A-Za-z0-9_-]'
TOKEN_PATH_RE="/boot/[0-9a-fA-F:%-]{12,40}/$B64U{43}([^A-Za-z0-9_-]|\$)"
TOKEN_KV_RE="(token[\"']?[[:space:]]*[=:][[:space:]]*[\"']?)$B64U{43}([^A-Za-z0-9_-]|\$)"
HASH_RE='\$6\$(rounds=[0-9]+\$)?[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{20,}'
PKEY_RE='-----BEGIN [A-Z ]*PRIVATE KEY-----'
B64_RUN_RE='[A-Za-z0-9+/]{40,}={0,2}'
B64_INNER_RE='[A-Za-z0-9+/]{16,}={0,2}'
B64_MARK='REDACTED-B64-SECRET'
B64_DEC_SECRET_RE="/boot/[0-9a-fA-F:%-]{12,40}/$B64U{43}"

# _b64_secret <blob> <depth>: exit 0 bila blob ter-decode memuat secret (lihat header).
_b64_secret() {
  local blob="$1" depth="$2" off s dec inner
  for off in 0 1 2 3; do
    s="${blob:off}"; s="${s%%=*}"
    ((${#s} >= 16)) || continue
    s="${s:0:$((${#s} / 4 * 4))}"
    # NUL dibuang (UTF-16LE -> ASCII) sebelum masuk variabel bash.
    dec="$(printf '%s' "$s" | base64 -d 2>/dev/null | tr -d '\000' || true)"
    [[ -n "$dec" ]] || continue
    if grep -Eqa -e "$B64_DEC_SECRET_RE" -e '\$6\$' -e 'PRIVATE KEY' <<<"$dec"; then return 0; fi
    if ((depth > 0)); then
      while IFS= read -r inner; do
        _b64_secret "$inner" $((depth - 1)) && return 0
      done < <(grep -Eoa "$B64_INNER_RE" <<<"$dec" | sort -u || true)
    fi
  done
  return 1
}

# _b64_blobs <file>: blob kandidat unik, terpanjang dulu (agar substring tidak merusak penggantian).
_b64_blobs() {
  { grep -Eoa "$B64_RUN_RE" "$1" || true; } | sort -u | awk '{ print length($0), $0 }' | sort -rn | cut -d' ' -f2-
}

# _b64_redact <file>: ganti blob ber-secret dengan $B64_MARK (in-place). Karakter blob
# [A-Za-z0-9+/=] literal di regex dasar sed dengan delimiter '#'.
_b64_redact() {
  local f="$1" blob
  while IFS= read -r blob; do
    [[ -n "$blob" ]] || continue
    if _b64_secret "$blob" 2; then sed -i "s#$blob#$B64_MARK#g" "$f"; fi
  done < <(_b64_blobs "$f")
}

# _b64_scan <file>: cetak <file>:<baris> untuk blob ber-secret yang tersisa.
_b64_scan() {
  local f="$1" ln blob
  while IFS=: read -r ln blob; do
    if _b64_secret "$blob" 2; then printf '%s:%s\n' "$f" "$ln"; fi
  done < <(grep -Enoa "$B64_RUN_RE" "$f" || true)
}

n=0
while IFS= read -r -d '' f; do
  n=$((n + 1))
  sed -E -i \
    -e "s#(/boot/[0-9a-fA-F:%-]{12,40}/)$B64U{43}([^A-Za-z0-9_-]|\$)#\1REDACTED-TOKEN\2#g" \
    -e "s#$TOKEN_KV_RE#\1REDACTED-TOKEN\2#gI" \
    -e "s#$HASH_RE#\$6\$REDACTED#g" \
    "$f"
  _b64_redact "$f"
done < <(find "$dir" -type f -print0)

hits="$(find "$dir" -type f -exec grep -EnaH -i -e "$TOKEN_PATH_RE" -e "$TOKEN_KV_RE" -e "$HASH_RE" -e "$PKEY_RE" {} + \
  | cut -d: -f1,2 | head -50 || true)"
while IFS= read -r -d '' f; do
  b64hits="$(_b64_scan "$f" | head -50)"
  [[ -z "$b64hits" ]] || hits+="${hits:+$'\n'}$b64hits"
done < <(find "$dir" -type f -print0)

if [[ -n "$hits" ]]; then
  echo "redact-evidence: TEMUAN secret setelah redaksi di $dir:" >&2
  echo "$hits" >&2
  exit 1
fi
echo "redact-evidence: $n file di $dir bersih (token/hash disamarkan)" >&2
