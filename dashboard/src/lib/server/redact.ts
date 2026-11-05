// Redaksi secret sisi server untuk pesan event/log job (M5, plan §2.4, DEC-014 §4). Pola selaras
// `infra/redact-evidence.sh`: token di path boot, `token=`/`"token":`, hash SHA-512 crypt, blok
// private key, dan blob base64 (UTF-8/UTF-16LE, offset 0–3, hingga 2 lapis) yang memuat salah satu
// pola itu. Fungsi murni, idempoten: keluaran tidak lagi memuat pola yang dikenali.

const B64U = "[A-Za-z0-9_-]"
/** `/boot/<mac>/<token 43>` (MAC `aa:bb:..`, `aa-bb-..`, `%3A`, atau 12 hex). */
const TOKEN_PATH_RE = new RegExp(`(/boot/[0-9A-Fa-f:%-]{12,40}/)${B64U}{43}(?![A-Za-z0-9_-])`, "g")
/** `token=<43>`, `token: <43>`, `"token":"<43>"`. */
const TOKEN_KV_RE = new RegExp(`(token["']?\\s*[=:]\\s*["']?)${B64U}{43}(?![A-Za-z0-9_-])`, "gi")
/** Hash SHA-512 crypt `$6$[rounds=N$]salt$hash`. */
const HASH_RE = /\$6\$(?:rounds=\d+\$)?[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{20,}/g
/** Blok private key (OpenSSH/PEM), juga bila terpotong tanpa footer. */
const PKEY_BLOCK_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
const B64_RUN_RE = /[A-Za-z0-9+/]{40,}={0,2}/g
const B64_INNER_RE = /[A-Za-z0-9+/]{16,}={0,2}/g
const SECRET_IN_DECODED_RE = new RegExp(`/boot/[0-9A-Fa-f:%-]{12,40}/${B64U}{43}|\\$6\\$|PRIVATE KEY|token["']?\\s*[=:]\\s*["']?${B64U}{43}`)

export const REDACTED = "[REDACTED]"
export const HASH_REDACTED = "$6$" + REDACTED
export const REDACTED_KEY ="[REDACTED PRIVATE KEY]"
export const REDACTED_B64 = "[REDACTED-B64]"

function b64HasSecret(blob: string, depth: number): boolean {
  for (let off = 0; off < 4; off++) {
    let s = blob.slice(off).replace(/=+$/, "")
    if (s.length < 16) continue
    s = s.slice(0, s.length - (s.length % 4))
    const buf = Buffer.from(s, "base64")
    for (const dec of [buf.toString("utf8"), buf.toString("utf16le")]) {
      const clean = dec.replaceAll("\0", "")
      if (SECRET_IN_DECODED_RE.test(clean)) return true
      if (depth > 0) {
        for (const m of clean.matchAll(B64_INNER_RE)) {
          if (b64HasSecret(m[0], depth - 1)) return true
        }
      }
    }
  }
  return false
}

/** Samarkan secret di `text` (lihat header). Teks tanpa secret dikembalikan identik. */
export function redactSecrets(text: string): string {
  let out = text
    .replace(PKEY_BLOCK_RE, REDACTED_KEY)
    .replace(TOKEN_PATH_RE, `$1${REDACTED}`)
    .replace(TOKEN_KV_RE, `$1${REDACTED}`)
    .replace(HASH_RE, () => HASH_REDACTED)
  out = out.replace(B64_RUN_RE, (blob) => (b64HasSecret(blob, 2) ? REDACTED_B64 : blob))
  return out
}
