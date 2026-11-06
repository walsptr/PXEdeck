// Redaksi secret sisi server untuk pesan event/log job (M5 plan §2.4, DEC-014 §4; M6 plan §2.5,
// DEC-017 §10 / O14). Pola selaras `infra/redact-evidence.sh`: token di path boot, `token=`/
// `"token":`, hash SHA-512 crypt, blok/ekor private key, dan blob base64 (UTF-8/UTF-16LE, offset
// 0–3, hingga 2 lapis) yang memuat salah satu pola itu. Fungsi murni, idempoten, linear.
//
// Arsitektur (M6): deteksi berjalan di beberapa SALINAN teks, masing-masing dengan peta indeks ke
// teks mentah (`View`). Setiap karakter yang terdeteksi sebagai secret di salinan mana pun ditandai
// per karakter mentah (`markInto`), lalu satu salinan "tampilan" dirender dengan setiap rangkaian
// karakter bertanda diganti placeholder (`renderMarked`). Salinan:
//  - tampilan (`cleanAndRedact`): `plain` (kontrol dibuang; sisa ANSI `[31m` tetap — AC-5.13),
//    `bare` (sekuens ANSI dibuang utuh), `sgr` (hanya SGR `ESC[…m` + OSC 8 utuh dibuang, escape lain
//    hanya byte ESC-nya — CR-5-30/SR-5-19), `greedy` (pola ANSI M5: `ESC7` ikut dibuang utuh);
//  - pencocokan (`matchView`, M6 SR-5-13/18/20, CR-5-21): turunan tiap salinan tampilan dengan
//    karakter tak terlihat dibuang (`\p{Default_Ignorable_Code_Point}`, `\p{Co}` termasuk sentinel,
//    tanda gabung `\p{Mn}`/`\p{Me}`) lalu dinormalisasi: decode persen dua lapis (`%252F` → `/`),
//    `\/` `\$` `\"` `/` → karakter aslinya, `$$` → `$`.
//
// Perilaku yang diterima & sisa risiko (SR-5-15; diuji satu per satu di `m6-redact.test.ts`,
// "perilaku terdokumentasi"):
// | Masukan                                              | Hasil                                     |
// |------------------------------------------------------|-------------------------------------------|
// | `awk '{print $6$7}'`                                 | `awk '{print $6$[REDACTED]}'` (over)       |
// | `-----BEGIN … PRIVATE KEY-----` tanpa footer         | sisa body sejak BEGIN → placeholder (over) |
// | footer END yatim                                     | footer + baris berbentuk isi key di atasnya|
// |                                                      | (base64 ≥ 16, atau kata pendek tepat di    |
// |                                                      | atas footer bila di atasnya baris key)     |
// | `/boot/<machine-id 32 hex>/<segmen ≥ 8 [A-Za-z0-9_-]>`| segmen → `[REDACTED]` (path BLS, over)     |
// | `token=<8+ karakter token>`                          | nilai → `[REDACTED]` (juga bukan token)    |
// | ≥ 2 baris base64 berurutan tepat 64/70 karakter      | → `[REDACTED PRIVATE KEY]` (isi PEM/OpenSSH|
// | (bukan heksadesimal murni, huruf besar+kecil)        | tanpa BEGIN/END; juga isi sertifikat, over)|
// | emoji ber-ZWJ (`👨‍👩‍👧`)                                  | ZWJ (Cf) dibuang → `👨👩👧`                 |
// Sisa risiko (diketahui, tidak ditutup): token/hash yang ter-wrap ke baris berikutnya (bagian
// setelah newline < 8 karakter atau tanpa prefiks); prefiks token 1–7 karakter; token yang diikuti
// langsung karakter token lain (rangkaian ≥ 44, mis. `<token>X` — sengaja bukan token, M5 AC-5.14);
// isi key yang hanya satu baris per request tanpa BEGIN/END (rangkaian < 2); baris isi key dengan
// prefiks log di luar daftar `LOG_PREFIX_RE`; homoglyph (digit fullwidth, huruf Kiril) di dalam
// token; encoding selain persen/JSON/backslash (mis. base32, hex, HTML entity); base64 ter-wrap dengan
// lebar selain 60/64/76 atau baris tidak seragam (SR-6-4: lebar umum digabung sebelum didekode); baris
// terakhir base64 ter-wrap TANPA padding yang membuat total panjang bukan kelipatan 4 (tidak ikut ditandai).

const B64U = "[A-Za-z0-9_-]"
/** `/boot/<mac>/<token 43>` (MAC `aa:bb:..`, `aa-bb-..`, `%3A`, atau 12 hex). */
const TOKEN_PATH_RE = new RegExp(`(/boot/[0-9A-Fa-f:%-]{12,40}/)${B64U}{43}(?![A-Za-z0-9_-])`, "g")
/** Token path parsial/terpotong (8–43 karakter, diikuti non-token atau akhir teks). */
const TOKEN_PATH_PARTIAL_RE = new RegExp(`(/boot/[0-9A-Fa-f:%-]{12,40}/)${B64U}{8,43}(?![A-Za-z0-9_-])`, "g")
/** `%2Fboot%2F<mac>%2F<token 8–43>` (percent-encoded, huruf besar/kecil). */
const TOKEN_PATH_PCT_RE = new RegExp(`(%2Fboot%2F[0-9A-Fa-f:%-]{12,60}?%2F)${B64U}{8,43}(?![A-Za-z0-9_-])`, "gi")
/** `token=<…>`, `token: <…>`, `"token":"<…>"` — M6: parsial 8–43 (CR-5-21/CR-5-30). */
const TOKEN_KV_RE = new RegExp(`(token["']?\\s*[=:]\\s*["']?)${B64U}{8,43}(?![A-Za-z0-9_-])`, "gi")
/** Hash SHA-512 crypt `$6$[rounds=N$]salt$hash`. */
const HASH_RE = /\$6\$(?:rounds=\d+\$)?[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{20,}/g
/** Hash `$6$` terpotong: `$6$` + salt (≥ 1 karakter) + sisa hash berapa pun panjangnya. */
const HASH_PARTIAL_RE = /\$6\$(?:rounds=\d+\$)?[./A-Za-z0-9]+(?:\$[./A-Za-z0-9]*)?/g
/** Blok private key (OpenSSH/PEM), juga bila terpotong tanpa footer. */
const PKEY_BLOCK_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
/** Footer private key tanpa BEGIN sebelumnya (blok terpecah antar-request). */
const PKEY_END_RE = /-----END [A-Z ]*PRIVATE KEY-----/g
/**
 * Baris isi key (diuji atas baris yang sudah di-`trim()` dan dilepas prefiks lognya; pola tanpa
 * kuantor bertumpuk sehingga linear, SR-5-11): base64 murni + padding opsional.
 */
const PKEY_BODY_LINE_RE = /^[A-Za-z0-9+/]+={0,2}$/
/**
 * Prefiks log umum di depan baris isi key (CR-5-20a / SR-5-14), dilepas berulang (maks 4): kernel
 * `[  1.234] `, ISO `2026-11-06T01:02:03Z ` / `2026-11-06 01:02:03,123 [LEVEL] `, syslog
 * `Nov  6 01:02:03 [host ]`, anaconda `01:02:03,123 [INF] `, `proses[pid]: `, `proses: `,
 * `modul.python:123 `. Semua ter-anchor, tanpa kuantor bertumpuk.
 */
const LOG_PREFIX_RE = new RegExp(
  [
    "\\[\\s*\\d+\\.\\d+\\]\\s+",
    "\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?\\s+(?:[A-Z]{3,8}\\s+)?",
    "[A-Z][a-z]{2} +\\d{1,2} \\d{2}:\\d{2}:\\d{2}\\s+(?:[\\w.-]+ (?=[\\w./-]+(?:\\[\\d+\\])?: ))?",
    "\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?\\s+(?:[A-Z]{3,8}\\s+)?",
    "[A-Za-z][\\w./@-]*(?:\\[\\d+\\])?:\\s+",
    "[A-Za-z][\\w.]*:\\d+\\s+",
  ]
    .map((p) => `(?:${p})`)
    .join("|")
    .replace(/^/, "^(?:")
    .concat(")"),
)
/** Kata biasa (bukan isi key) untuk baris pendek tepat di atas footer. */
const WORD_RE = /^(?:[A-Z]?[a-z]+|[A-Z]+)$/
/** Panjang minimum baris isi key (baris OpenSSH/PEM 64/70 karakter; CR-5-19). */
const PKEY_BODY_MIN = 16
/** Lebar baris isi key OpenSSH (70) dan PEM (64) untuk deteksi rangkaian tanpa BEGIN/END (CR-5-20b). */
const KEY_RUN_WIDTHS = new Set([64, 70])
const HEX_RE = /^[0-9A-Fa-f]+$/
const B64_RUN_RE = /[A-Za-z0-9+/]{40,}={0,2}/g
const B64_INNER_RE = /[A-Za-z0-9+/]{16,}={0,2}/g
const SECRET_IN_DECODED_RE = new RegExp(
  `/boot/[0-9A-Fa-f:%-]{12,40}/${B64U}{8}|%2[Ff]boot%2[Ff][0-9A-Fa-f:%-]{12,60}?%2[Ff]${B64U}{8}|\\$6\\$|PRIVATE KEY|token["']?\\s*[=:]\\s*["']?${B64U}{8}`,
)

export const REDACTED = "[REDACTED]"
export const HASH_REDACTED = "$6$" + REDACTED
export const REDACTED_KEY = "[REDACTED PRIVATE KEY]"
export const REDACTED_B64 = "[REDACTED-B64]"

function b64HasSecret(blob: string, depth: number): boolean {
  for (let off = 0; off < 4; off++) {
    let s = blob.slice(off).replace(/=+$/, "")
    if (s.length < 16) continue
    s = s.slice(0, s.length - (s.length % 4))
    const buf = Buffer.from(s, "base64")
    // UTF-16LE hanya bisa menghasilkan karakter ASCII (semua pola di sini ASCII) bila ada byte 0x00;
    // tanpa byte nol dekode UTF-16LE dilewati — hasil identik, separuh kerja (SR-5-11/SR-6-4).
    for (const dec of buf.includes(0) ? [buf.toString("utf8"), buf.toString("utf16le")] : [buf.toString("utf8")]) {
      const clean = dec.replaceAll("\0", "")
      if (SECRET_IN_DECODED_RE.test(clean)) return true
      if (depth > 0) {
        // SR-6-4: base64 lapis dalam yang ter-wrap digabung (baris baru dibuang) sebelum dicari —
        // satu rangkaian panjang alih-alih ratusan potongan per baris (tetap linear).
        for (const m of clean.replace(/[\r\n]+/g, "").matchAll(B64_INNER_RE)) {
          if (b64HasSecret(m[0], depth - 1)) return true
        }
      }
    }
  }
  return false
}

/** Lepas prefiks log umum (maks 4 lapis) lalu `trim()` (CR-5-20a). */
function keyLineCore(line: string): string {
  let t = line.trim()
  for (let i = 0; i < 4; i++) {
    const m = LOG_PREFIX_RE.exec(t)
    if (!m || m[0].length === 0) break
    t = t.slice(m[0].length).trim()
  }
  return t
}

/**
 * Apakah `line` berbentuk baris isi key (CR-5-19)? Base64 ≥ PKEY_BODY_MIN karakter (setelah prefiks
 * log dilepas). Baris pendek hanya boleh sebagai baris non-kosong pertama di atas footer (`adjacent`;
 * baris kosong di antaranya diabaikan) — baris terakhir isi key, OpenSSH membungkus 70 kolom sehingga
 * panjangnya bebas — dan hanya bila tidak berbentuk kata (`Done`, `OK`, `DONE`), KECUALI baris
 * non-kosong di atasnya adalah baris isi key ≥ PKEY_BODY_MIN (`longAbove`, SR-5-17/CR-5-23).
 */
function isKeyBodyLine(line: string, adjacent: boolean, longAbove: () => boolean): boolean {
  const t = keyLineCore(line)
  if (!PKEY_BODY_LINE_RE.test(t)) return false
  if (t.length >= PKEY_BODY_MIN) return true
  if (!adjacent) return false
  return !WORD_RE.test(t) || longAbove()
}

/** Apakah baris non-kosong pertama di atas `end` (≥ `limit`) adalah baris key ≥ 16? */
function longKeyLineAbove(text: string, end: number, limit: number): boolean {
  let cursor = end
  while (cursor > limit) {
    const prevStart = cursor < 2 ? 0 : text.lastIndexOf("\n", cursor - 2) + 1
    if (prevStart < limit) return false
    const t = keyLineCore(text.slice(prevStart, cursor - 1))
    if (t !== "") return t.length >= PKEY_BODY_MIN && PKEY_BODY_LINE_RE.test(t)
    cursor = prevStart
  }
  return false
}

/** Rentang `[start, end)` di teks yang harus disamarkan sebagai private key. */
type Range = [number, number]

/**
 * Footer END yatim (BEGIN ada di request/baris sebelumnya): samarkan baris footer beserta baris isi
 * key yang mendahuluinya secara berurutan (lihat `isKeyBodyLine`). Baris kosong hanya ikut bila
 * diapit baris isi key / awal teks; baris kosong yang di atasnya teks biasa tidak ditelan (CR-5-19).
 * Dijalankan atas teks yang blok BEGIN…END-nya sudah ditandai, jadi footer yang tersisa pasti tanpa
 * BEGIN. CR-5-20c (M6): SEMUA footer diproses dalam satu lintasan (tanpa batas 64); pemindaian mundur
 * tiap footer dibatasi akhir footer sebelumnya (`limit`) sehingga total tetap linear.
 */
function orphanKeyTailRanges(text: string): Range[] {
  const out: Range[] = []
  let limit = 0
  for (const m of text.matchAll(PKEY_END_RE)) {
    const footerEnd = m.index + m[0].length
    let start = Math.max(text.lastIndexOf("\n", m.index - 1) + 1, limit)
    // `cursor` = awal baris teratas yang sudah diperiksa; `start` hanya maju ke baris isi key (atau
    // baris kosong yang di atasnya baris isi key / awal teks). `adjacent` = belum ada baris
    // non-kosong yang diperiksa (baris kosong tepat di atas footer tidak memutus adjacency).
    let cursor = start
    let adjacent = true
    while (cursor > limit) {
      const prevStart = cursor < 2 ? 0 : text.lastIndexOf("\n", cursor - 2) + 1
      // Baris yang dimulai sebelum `limit` memuat footer sebelumnya (sudah disamarkan) → berhenti.
      if (prevStart < limit) break
      const line = text.slice(prevStart, cursor - 1)
      if (line.trim() === "") {
        if (prevStart === 0) start = 0
        cursor = prevStart
        continue
      }
      if (!isKeyBodyLine(line, adjacent, () => longKeyLineAbove(text, prevStart, limit))) break
      adjacent = false
      cursor = prevStart
      start = prevStart
    }
    out.push([start, footerEnd])
    limit = footerEnd
  }
  return out
}

/**
 * CR-5-20b (M6): rangkaian ≥ 2 baris berurutan yang (setelah prefiks log dilepas) berupa base64
 * murni selebar tepat 64 atau 70 karakter (isi PEM/OpenSSH) — tanpa BEGIN maupun END di body —
 * beserta satu baris penutup base64 yang lebih pendek tepat di bawahnya. Baris heksadesimal murni
 * (digest sha256) dan baris tanpa huruf besar+kecil tidak dihitung (hindari over-redaksi). Linear.
 */
function keyBodyRunRanges(text: string): Range[] {
  const out: Range[] = []
  const isFull = (t: string) =>
    KEY_RUN_WIDTHS.has(t.length) && PKEY_BODY_LINE_RE.test(t) && !HEX_RE.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t)
  let runStart = -1
  let runWidth = 0
  let runLines = 0
  let lastEnd = 0
  let pos = 0
  /** Tutup rangkaian; `tail` = inti baris tepat di bawahnya (null = akhir teks), berakhir di `tailEnd`. */
  const close = (tailEnd: number, tail: string | null) => {
    if (runLines >= 2) {
      const shortTail =
        tail !== null &&
        tail.length < runWidth &&
        PKEY_BODY_LINE_RE.test(tail) &&
        (tail.length >= PKEY_BODY_MIN || !WORD_RE.test(tail))
      out.push([runStart, shortTail ? tailEnd : lastEnd])
    }
    runStart = -1
    runLines = 0
  }
  while (pos <= text.length) {
    let nl = text.indexOf("\n", pos)
    if (nl < 0) nl = text.length
    const t = keyLineCore(text.slice(pos, nl))
    if (isFull(t) && (runLines === 0 || t.length === runWidth)) {
      if (runLines === 0) {
        runStart = pos
        runWidth = t.length
      }
      runLines++
      lastEnd = nl
    } else {
      if (runLines > 0) close(nl, t)
      if (isFull(t)) {
        runStart = pos
        runWidth = t.length
        runLines = 1
        lastEnd = nl
      }
    }
    pos = nl + 1
  }
  if (runLines > 0) close(text.length, null)
  return out
}

/** Lebar baris base64 ter-wrap yang umum: PEM/MIME 64, `openssl -A`-less 60, GNU `base64` 76 (SR-6-4). */
const B64_WRAP_WIDTHS = new Set([60, 64, 76])

/**
 * SR-6-4 (M6 iter2): base64 ter-wrap (mis. keluaran GNU `base64` 76 kolom). Rangkaian ≥ 2 baris
 * berurutan yang (setelah prefiks log dilepas) berupa base64 murni: semua baris selain terakhir
 * selebar sama W ∈ {60, 64, 76}, baris terakhir ≤ W (lebih pendek atau berpadding `=` menutup
 * rangkaian, dan hanya bila total panjang rangkaian kelipatan 4). Isi baris digabung lalu didekode (`b64HasSecret`); bila memuat secret, inti setiap baris
 * ditandai (baris tetap terpisah, prefiks log tetap tampil). Setiap baris diperiksa sekali dan setiap
 * rangkaian didekode sekali → linear (SR-5-11).
 */
function wrappedB64Ranges(text: string): Range[] {
  const out: Range[] = []
  let cores: Range[] = []
  let parts: string[] = []
  let width = 0
  let total = 0
  let closed = false
  const flush = () => {
    if (cores.length >= 2 && b64HasSecret(parts.join(""), 2)) out.push(...cores)
    cores = []
    parts = []
    width = 0
    total = 0
    closed = false
  }
  let pos = 0
  while (pos <= text.length) {
    let nl = text.indexOf("\n", pos)
    if (nl < 0) nl = text.length
    const line = text.slice(pos, nl)
    const core = keyLineCore(line)
    if (core.length > 0 && PKEY_BODY_LINE_RE.test(core)) {
      const end = pos + line.trimEnd().length
      const r: Range = [end - core.length, end]
      const padded = core.endsWith("=")
      // Baris penutup (lebih pendek/berpadding) hanya bila total panjang kelipatan 4 (keluaran base64
      // berpadding selalu demikian) — kata biasa di bawah blok (`selesai`) tidak ikut ditandai.
      const last = core.length < width || padded
      if (cores.length > 0 && !closed && core.length <= width && (!last || (total + core.length) % 4 === 0)) {
        cores.push(r)
        parts.push(core)
        total += core.length
        closed = last
      } else {
        flush()
        if (B64_WRAP_WIDTHS.has(core.length) && !padded) {
          cores.push(r)
          parts.push(core)
          width = core.length
          total = core.length
        }
      }
    } else flush()
    pos = nl + 1
  }
  flush()
  return out
}

/** Sentinel (Private Use Area) untuk `secretMarks`: satu karakter per karakter yang disamarkan. */
export const MARK_PLAIN = ""
export const MARK_KEY = ""
export const MARK_B64 = ""

function fillRanges(text: string, ranges: Range[], mark: string): string {
  if (ranges.length === 0) return text
  const parts: string[] = []
  let last = 0
  for (const [s, e] of ranges) {
    parts.push(text.slice(last, s), mark.repeat(e - s))
    last = e
  }
  parts.push(text.slice(last))
  return parts.join("")
}

/**
 * Deteksi secret di `text`: setiap karakter yang harus disamarkan diganti SATU sentinel
 * (`MARK_PLAIN`/`MARK_KEY`/`MARK_B64`) sehingga panjang dan posisi tetap: karakter ke-i disamarkan
 * ⇔ `marks[i] !== text[i]`. Pola dijalankan berurutan atas hasil sebelumnya; sentinel bukan
 * karakter token/base64 sehingga tidak membentuk pola baru. Pemanggil wajib membuang `\p{Co}`
 * (termasuk sentinel) dari teks lebih dulu (`matchView`) agar perbandingan tidak ambigu (SR-5-20).
 */
export function secretMarks(text: string): string {
  const plain = (s: string) => MARK_PLAIN.repeat(s.length)
  const keep = (m: string, p1: string) => p1 + plain(m.slice(p1.length))
  const hash = (m: string) => "$6$" + plain(m.slice(3))
  let out = text.replace(PKEY_BLOCK_RE, (m) => MARK_KEY.repeat(m.length))
  out = fillRanges(out, orphanKeyTailRanges(out), MARK_KEY)
  out = fillRanges(out, keyBodyRunRanges(out), MARK_KEY)
  out = fillRanges(out, wrappedB64Ranges(out), MARK_B64)
  out = out
    .replace(TOKEN_PATH_RE, keep)
    .replace(TOKEN_PATH_PARTIAL_RE, keep)
    .replace(TOKEN_PATH_PCT_RE, keep)
    .replace(TOKEN_KV_RE, keep)
    .replace(HASH_RE, hash)
    .replace(HASH_PARTIAL_RE, hash)
  return out.replace(B64_RUN_RE, (blob) => (b64HasSecret(blob, 2) ? MARK_B64.repeat(blob.length) : blob))
}

/** Placeholder teks untuk sentinel `secretMarks`. */
export function markPlaceholder(mark: string): string {
  return mark === MARK_KEY ? REDACTED_KEY : mark === MARK_B64 ? REDACTED_B64 : REDACTED
}

// ---------------------------------------------------------------------------------------------
// Salinan teks ber-peta indeks.

/** Salinan teks: karakter ke-i berasal dari rentang mentah `[start[i], end[i])`. */
export type View = { text: string; start: Int32Array; end: Int32Array }

export function identityView(raw: string): View {
  const start = new Int32Array(raw.length)
  const end = new Int32Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    start[i] = i
    end[i] = i + 1
  }
  return { text: raw, start, end }
}

/**
 * Ganti setiap kecocokan `re` (flag g) dengan `rep(match)` (panjang ≤ kecocokan; `null` = biarkan);
 * karakter pengganti dipetakan ke seluruh rentang mentah kecocokan. Tanpa perubahan → `v` apa adanya.
 */
export function mapMatches(v: View, re: RegExp, rep: (m: RegExpExecArray) => string | null = () => ""): View {
  const src = v.text
  const parts: string[] = []
  let start: Int32Array | null = null
  let end: Int32Array | null = null
  let n = 0
  let last = 0
  const keepMap = (from: number, to: number) => {
    parts.push(src.slice(from, to))
    for (let k = from; k < to; k++, n++) {
      start![n] = v.start[k]
      end![n] = v.end[k]
    }
  }
  re.lastIndex = 0
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const r = rep(m)
    if (r === null || r === m[0]) continue
    if (start === null) {
      start = new Int32Array(src.length)
      end = new Int32Array(src.length)
    }
    keepMap(last, m.index)
    const s0 = v.start[m.index]
    const e0 = v.end[m.index + m[0].length - 1]
    parts.push(r)
    for (let k = 0; k < r.length; k++, n++) {
      start[n] = s0
      end![n] = e0
    }
    last = m.index + m[0].length
  }
  if (start === null) return v
  keepMap(last, src.length)
  return { text: parts.join(""), start: start.subarray(0, n), end: end!.subarray(0, n) }
}

// C0 (kecuali \t), DEL, C1, U+2028/U+2029 (pemisah baris), karakter format Unicode (Cf: U+00AD,
// U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+FEFF, dst. — SR-5-12), dan surrogate tunggal (M6
// SR-5-18; dengan flag `u` kelas `\uD800-\uDFFF` hanya cocok dengan surrogate yang tidak berpasangan).
// Ditulis dengan escape agar sumber tetap ASCII.
const CONTROL_CLASS_BASE = "\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f\\u2028\\u2029\\p{Cf}\\uD800-\\uDFFF"
const CONTROL_RE = new RegExp(`[\\x00-\\x08\\x0a\\x0d${CONTROL_CLASS_BASE}]`, "gu")
// Sama dengan CONTROL_RE tetapi mempertahankan \n dan \r (untuk body log multi-baris).
const CONTROL_KEEP_NL_RE = new RegExp(`[\\x00-\\x08${CONTROL_CLASS_BASE}]`, "gu")
/**
 * Hanya untuk salinan PENCOCOKAN (tidak mengubah tampilan, mis. emoji VS16 tetap): karakter tak
 * terlihat / penyela — Default_Ignorable (U+034F, U+115F, U+3164, U+FE00–U+FE0F, tag, …), format
 * `\p{Cf}`, Private Use `\p{Co}` (termasuk sentinel MARK_*; SR-5-20), tanda gabung `\p{Mn}`/`\p{Me}`,
 * surrogate tunggal, dan kontrol C0/C1 selain \t \n \r (agar `redactSecrets` mandiri juga kebal).
 */
const INVISIBLE_RE =
  /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Co}\p{Mn}\p{Me}\uD800-\uDFFF\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/gu

// Sekuens escape ANSI utuh (CR-5-18): CSI `ESC[ … final`, CSI 8-bit `\x9b … final`, OSC
// `ESC] … BEL|ESC\` (tidak melewati baris), dan escape nF ber-intermediate (`ESC(B`, `ESC#8`).
// M6 (CR-5-30/SR-5-19): alternatif ke-4 WAJIB punya ≥ 1 byte intermediate `[ -/]`; ESC tunggal +
// huruf/angka (`ESC7`, `ESC=`, `ESCt`) tidak lagi menelan karakter sesudahnya — ESC-nya saja yang
// dibuang oleh `stripControl`.
const ANSI_RE = new RegExp(
  [
    "\\x1b\\[[0-?]*[ -/]*[@-~]",
    "\\x9b[0-?]*[ -/]*[@-~]",
    "\\x1b\\][^\\x07\\x1b\\n]*(?:\\x07|\\x1b\\\\)",
    "\\x1b[ -/]+[0-~]",
  ].join("|"),
  "g",
)
/**
 * Salinan pencocokan `greedy`: pola ANSI M5 (alternatif ke-4 tanpa wajib intermediate,
 * `\x1b[ -/]*[0-~]`). Membatasi alternatif ke-4 (CR-5-30) membuat `ESC7`/`ESCc` di tengah token
 * menyisakan `7`/`c` di semua salinan lain; salinan ini tetap membuang escape dua byte itu utuh.
 */
const ANSI_GREEDY_RE = new RegExp(
  [
    "\\x1b\\[[0-?]*[ -/]*[@-~]",
    "\\x9b[0-?]*[ -/]*[@-~]",
    "\\x1b\\][^\\x07\\x1b\\n]*(?:\\x07|\\x1b\\\\)",
    "\\x1b[ -/]*[0-~]",
  ].join("|"),
  "g",
)
/** Salinan `sgr` (CR-5-30/SR-5-19): hanya SGR (`ESC[…m`, `\x9b…m`) dan OSC 8 utuh yang dibuang. */
const SGR_RE = /\x1b\[[0-9;:]*m|\x9b[0-9;:]*m|\x1b\]8;[^\x07\x1b\n]*(?:\x07|\x1b\\)/g

/**
 * Buang karakter kontrol & format (kecuali \t; `keepNewlines` juga mempertahankan \n/\r). Tanpa
 * pemotongan panjang.
 */
export function stripControl(raw: string, keepNewlines = false): string {
  return raw.replace(keepNewlines ? CONTROL_KEEP_NL_RE : CONTROL_RE, "")
}

/** Buang sekuens escape ANSI utuh (CSI/OSC/escape ber-intermediate), tanpa menyentuh karakter lain. */
export function stripAnsi(raw: string): string {
  return raw.replace(ANSI_RE, "")
}

const PCT_RE = /%([2-7][0-9A-Fa-f])/g
/** Rangkaian `INVISIBLE_RE` ATAU `%XX` (kelompok 1) — lintasan pertama `matchView`. */
const INVISIBLE_PCT_RE = new RegExp(`${INVISIBLE_RE.source}+|%([2-7][0-9A-Fa-f])`, "gu")
/**
 * Rangkaian backslash (dicocokkan utuh sekali → linear), diikuti `u00XX` (escape JSON ASCII cetak)
 * atau salah satu `/ $ " '` → karakter itu; rangkaian lain dibiarkan.
 */
const BACKSLASH_RE = /\\+(?:u00([2-7][0-9A-Fa-f])|([/$"']))?/g
const DOLLARS_RE = /\$\$+/g
const printable = (hex: string) => {
  const c = parseInt(hex, 16)
  return c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : null
}

/**
 * Salinan pencocokan (SR-5-13/18/20, CR-5-21): buang karakter tak terlihat, decode persen dua lapis
 * (`%252F` → `%2F` → `/`; hanya ASCII cetak), lepas escape JSON/shell (`\/`, `\\\/`, `\$`, `\"`,
 * `/`), dan `$$` → `$`. Peta indeks dipertahankan (karakter hasil decode → rentang mentah).
 */
export function matchView(v: View): View {
  const pct = (m: RegExpExecArray) => printable(m[1])
  // Lintasan 1: rangkaian karakter tak terlihat dibuang + lapis persen pertama (satu regex).
  let w = mapMatches(v, INVISIBLE_PCT_RE, (m) => (m[1] === undefined ? "" : printable(m[1])))
  // Lintasan berikut hanya bila pemicunya ada (teks log biasa jarang memuat `%`, `\`, `$$`).
  if (w.text.includes("%")) w = mapMatches(w, PCT_RE, pct)
  if (w.text.includes("\\")) w = mapMatches(w, BACKSLASH_RE, (m) => (m[1] !== undefined ? printable(m[1]) : (m[2] ?? null)))
  if (w.text.includes("$$")) w = mapMatches(w, DOLLARS_RE, () => "$")
  return w
}

/**
 * Tandai karakter mentah yang terdeteksi secret di salinan `v` (`marked[j]` = kode sentinel, 0 =
 * tidak). Karakter mentah di antara dua karakter salinan berurutan yang bertanda sama (karakter yang
 * dibuang salinan itu: ANSI, kontrol, tak terlihat, `%2`) ikut ditandai agar tampilan menghasilkan
 * satu placeholder. Tanda yang sudah ada tidak ditimpa. Mengembalikan true bila ada tanda.
 */
export function markInto(marked: Uint16Array, v: View): boolean {
  const ms = secretMarks(v.text)
  if (ms === v.text) return false
  let found = false
  let prevKind = 0
  for (let i = 0; i < ms.length; i++) {
    const c = ms.charCodeAt(i)
    const k = c !== v.text.charCodeAt(i) ? c : 0
    if (k !== 0) {
      const from = prevKind === k ? v.end[i - 1] : v.start[i]
      for (let j = from; j < v.end[i]; j++) if (marked[j] === 0) marked[j] = k
      found = true
    }
    prevKind = k
  }
  return found
}

/** Render `base`: setiap rangkaian karakter bertanda sama → satu placeholder. */
export function renderMarked(base: View, marked: Uint16Array): string {
  const out: string[] = []
  let runStart = 0
  let prev = 0
  for (let i = 0; i <= base.text.length; i++) {
    const k = i < base.text.length ? marked[base.start[i]] : 0
    if (k === prev) continue
    if (prev === 0) out.push(base.text.slice(runStart, i))
    else out.push(markPlaceholder(String.fromCharCode(prev)))
    runStart = i
    prev = k
  }
  if (prev === 0) out.push(base.text.slice(runStart))
  return out.join("")
}

/** Dua salinan identik (teks DAN peta indeks) → deteksi yang sama; cukup sekali. */
function sameView(a: View, b: View): boolean {
  if (a.text !== b.text) return false
  for (let i = 0; i < a.start.length; i++) if (a.start[i] !== b.start[i] || a.end[i] !== b.end[i]) return false
  return true
}

/** Tandai `v` dan salinan pencocokannya. */
function markBoth(marked: Uint16Array, v: View): boolean {
  const a = markInto(marked, v)
  const m = matchView(v)
  const b = m === v ? false : markInto(marked, m)
  return a || b
}

/** Samarkan secret di `text` (lihat header). Teks tanpa secret dikembalikan identik. */
export function redactSecrets(text: string): string {
  const v = identityView(text)
  const marked = new Uint16Array(text.length)
  return markBoth(marked, v) ? renderMarked(v, marked) : text
}

/**
 * Bersihkan lalu redaksi (CR-5-18, SR-5-16, CR-5-24, M6 CR-5-30/SR-5-19). Empat salinan tampilan dibuat
 * dari teks mentah, masing-masing dengan peta indeks:
 *  - `plain` = karakter kontrol dibuang (termasuk byte ESC/\x9b saja; sisa `[31m` tetap — AC-5.13);
 *  - `bare`  = sekuens ANSI dibuang utuh dulu, lalu karakter kontrol;
 *  - `sgr`   = hanya SGR + OSC 8 utuh dibuang, lalu karakter kontrol (escape lain hanya byte ESC);
 *  - `greedy` = pola ANSI M5 (escape dua byte `ESC7`/`ESCc` ikut dibuang utuh), lalu kontrol.
 * Secret dideteksi di keempatnya DAN di salinan pencocokan masing-masing (`matchView`); tanda
 * digabung per karakter mentah. Tanpa secret → `plain` apa adanya. Bila ada secret, output dirender
 * dari `bare` (bila `bare` memuat secret), lalu `sgr`, `greedy`, `plain`; setiap karakter mentah yang
 * ditandai di salinan mana pun diganti placeholder. Satu escape yang merusak salinan A (mis. `ESC$6`
 * di `bare`) dan satu SGR yang merusak salinan B (`ESC[0m` di `plain`) tidak lagi bersamaan
 * meloloskan secret: salinan `sgr` melihatnya utuh. Sisa risiko: lihat header modul.
 */
export function cleanAndRedact(raw: string, keepNewlines = false): string {
  const ctrl = keepNewlines ? CONTROL_KEEP_NL_RE : CONTROL_RE
  const rawView = identityView(raw)
  const plain = mapMatches(rawView, ctrl)
  const marked = new Uint16Array(raw.length)
  const inPlain = markBoth(marked, plain)
  // Tanpa ESC/CSI 8-bit, `bare` dan `sgr` identik dengan `plain`.
  if (!raw.includes("\x1b") && !raw.includes("\x9b")) return inPlain ? renderMarked(plain, marked) : plain.text
  const bare = mapMatches(mapMatches(rawView, ANSI_RE), ctrl)
  const sgr = mapMatches(mapMatches(rawView, SGR_RE), ctrl)
  const greedy = mapMatches(mapMatches(rawView, ANSI_GREEDY_RE), ctrl)
  const inBare = sameView(bare, plain) ? inPlain : markBoth(marked, bare)
  const inSgr = sameView(sgr, plain) ? inPlain : sameView(sgr, bare) ? inBare : markBoth(marked, sgr)
  const inGreedy = sameView(greedy, bare) ? inBare : sameView(greedy, plain) ? inPlain : markBoth(marked, greedy)
  if (!inPlain && !inBare && !inSgr && !inGreedy) return plain.text
  return renderMarked(inBare ? bare : inSgr ? sgr : inGreedy ? greedy : plain, marked)
}
