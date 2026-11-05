// Redaksi secret sisi server untuk pesan event/log job (M5, plan §2.4, DEC-014 §4). Pola selaras
// `infra/redact-evidence.sh`: token di path boot, `token=`/`"token":`, hash SHA-512 crypt, blok
// private key, dan blob base64 (UTF-8/UTF-16LE, offset 0–3, hingga 2 lapis) yang memuat salah satu
// pola itu. Fungsi murni, idempoten: keluaran tidak lagi memuat pola yang dikenali.
//
// Iterasi 2 (CR-5-1/SR-5-5a, SR-5-2): token path parsial (8–43 karakter, mis. terpotong `cut -c1-240`
// di node) dan bentuk percent-encoded `%2Fboot%2F<mac>%2F<token>`; hash `$6$` terpotong; ekor blok
// private key tanpa BEGIN (baris base64 sebelum footer END yatim). Karakter kontrol harus dibuang
// pemanggil SEBELUM redaksi (`job-events.ts`), agar secret yang disisipi ESC/\x01 tetap dikenali.

const B64U = "[A-Za-z0-9_-]"
/** `/boot/<mac>/<token 43>` (MAC `aa:bb:..`, `aa-bb-..`, `%3A`, atau 12 hex). */
const TOKEN_PATH_RE = new RegExp(`(/boot/[0-9A-Fa-f:%-]{12,40}/)${B64U}{43}(?![A-Za-z0-9_-])`, "g")
/** Token path parsial/terpotong (8–43 karakter, diikuti non-token atau akhir teks). */
const TOKEN_PATH_PARTIAL_RE = new RegExp(`(/boot/[0-9A-Fa-f:%-]{12,40}/)${B64U}{8,43}(?![A-Za-z0-9_-])`, "g")
/** `%2Fboot%2F<mac>%2F<token 8–43>` (percent-encoded, huruf besar/kecil). */
const TOKEN_PATH_PCT_RE = new RegExp(`(%2Fboot%2F[0-9A-Fa-f:%-]{12,60}?%2F)${B64U}{8,43}(?![A-Za-z0-9_-])`, "gi")
/** `token=<43>`, `token: <43>`, `"token":"<43>"`. */
const TOKEN_KV_RE = new RegExp(`(token["']?\\s*[=:]\\s*["']?)${B64U}{43}(?![A-Za-z0-9_-])`, "gi")
/** Hash SHA-512 crypt `$6$[rounds=N$]salt$hash`. */
const HASH_RE = /\$6\$(?:rounds=\d+\$)?[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{20,}/g
/** Hash `$6$` terpotong: `$6$` + salt (≥ 1 karakter) + sisa hash berapa pun panjangnya. */
const HASH_PARTIAL_RE = /\$6\$(?:rounds=\d+\$)?[./A-Za-z0-9]+(?:\$[./A-Za-z0-9]*)?/g
/** Blok private key (OpenSSH/PEM), juga bila terpotong tanpa footer. */
const PKEY_BLOCK_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
/** Footer private key tanpa BEGIN sebelumnya (blok terpecah antar-request). */
const PKEY_END_RE = /-----END [A-Z ]*PRIVATE KEY-----/
/** Baris isi key (base64 atau kosong). */
const PKEY_BODY_LINE_RE = /^[ \t]*[A-Za-z0-9+/=]*[ \t]*\r?$/
const B64_RUN_RE = /[A-Za-z0-9+/]{40,}={0,2}/g
const B64_INNER_RE = /[A-Za-z0-9+/]{16,}={0,2}/g
const SECRET_IN_DECODED_RE = new RegExp(
  `/boot/[0-9A-Fa-f:%-]{12,40}/${B64U}{8}|%2[Ff]boot%2[Ff][0-9A-Fa-f:%-]{12,60}?%2[Ff]${B64U}{8}|\\$6\\$|PRIVATE KEY|token["']?\\s*[=:]\\s*["']?${B64U}{43}`,
)

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

/**
 * Footer END yatim (BEGIN ada di request/baris sebelumnya): samarkan baris footer beserta baris isi
 * key (base64/kosong) yang mendahuluinya secara berurutan. Dijalankan setelah `PKEY_BLOCK_RE`,
 * jadi footer yang tersisa pasti tanpa BEGIN.
 */
function redactOrphanKeyTail(text: string): string {
  let out = text
  for (let guard = 0; guard < 64; guard++) {
    const m = PKEY_END_RE.exec(out)
    if (!m) break
    const footerEnd = m.index + m[0].length
    let start = out.lastIndexOf("\n", m.index - 1) + 1
    while (start > 0) {
      const prevStart = start < 2 ? 0 : out.lastIndexOf("\n", start - 2) + 1
      if (!PKEY_BODY_LINE_RE.test(out.slice(prevStart, start - 1))) break
      start = prevStart
    }
    out = out.slice(0, start) + REDACTED_KEY + out.slice(footerEnd)
  }
  return out
}

/** Samarkan secret di `text` (lihat header). Teks tanpa secret dikembalikan identik. */
export function redactSecrets(text: string): string {
  let out = redactOrphanKeyTail(text.replace(PKEY_BLOCK_RE, REDACTED_KEY))
    .replace(TOKEN_PATH_RE, `$1${REDACTED}`)
    .replace(TOKEN_PATH_PARTIAL_RE, `$1${REDACTED}`)
    .replace(TOKEN_PATH_PCT_RE, `$1${REDACTED}`)
    .replace(TOKEN_KV_RE, `$1${REDACTED}`)
    .replace(HASH_RE, () => HASH_REDACTED)
    .replace(HASH_PARTIAL_RE, () => HASH_REDACTED)
  out = out.replace(B64_RUN_RE, (blob) => (b64HasSecret(blob, 2) ? REDACTED_B64 : blob))
  return out
}
