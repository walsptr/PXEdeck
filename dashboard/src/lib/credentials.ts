// Aturan credentials + generator password + parser CSV (browser & Node).

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/
const RESERVED = new Set(["root", "daemon", "bin", "sys", "nobody"])

export const PASSWORD_MIN = 8

export function validateUsername(u: string): string | null {
  const v = u.trim()
  if (!v) return "Username wajib diisi"
  if (!USERNAME_RE.test(v)) {
    return "Huruf kecil/angka/_/-, diawali huruf, maks 32 karakter"
  }
  if (RESERVED.has(v)) return `"${v}" adalah user sistem`
  return null
}

export function validatePassword(p: string): string | null {
  if (p.length < PASSWORD_MIN) return `Minimal ${PASSWORD_MIN} karakter`
  if (p.length > 128) return "Maksimal 128 karakter"
  if (/[\r\n]/.test(p)) return "Tidak boleh berisi baris baru"
  return null
}

// Tanpa karakter yang mudah tertukar (0/O, 1/l/I) dan tanpa tanda kutip.
const ALPHABET =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_@#%+="

// Karakter pertama selalu alfanumerik (SR-3-1): password yang diawali
// `= + - @` dievaluasi sebagai formula saat CSV unduhan dibuka di spreadsheet.
const ALNUM = ALPHABET.replace(/[^a-zA-Z0-9]/g, "")

/** `count` karakter acak seragam dari `chars` (rejection sampling). */
function randomChars(chars: string, count: number): string[] {
  const out: string[] = []
  const buf = new Uint32Array(Math.max(1, count * 2))
  const limit = Math.floor(0x100000000 / chars.length) * chars.length
  while (out.length < count) {
    crypto.getRandomValues(buf)
    for (const v of buf) {
      if (v < limit) out.push(chars[v % chars.length])
      if (out.length === count) break
    }
  }
  return out
}

/** Password acak; karakter pertama alfanumerik, sisanya dari `ALPHABET`. */
export function generatePassword(length = 16): string {
  if (length <= 0) return ""
  return [...randomChars(ALNUM, 1), ...randomChars(ALPHABET, length - 1)].join(
    "",
  )
}

/** Parser CSV minimal (RFC 4180: kutip ganda, koma, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        quoted = false
      } else {
        field += c
      }
    } else if (c === '"') {
      quoted = true
    } else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else {
      field += c
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""))
}

/** Awalan sel yang dievaluasi spreadsheet sebagai formula (OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * Netralkan sel berawalan `= + - @ TAB CR` dengan prefiks `'` agar spreadsheet
 * menampilkannya sebagai teks (praktik OWASP "CSV Injection"). Nilai lain
 * tidak berubah.
 */
export function neutralizeCsvCell(f: string): string {
  return FORMULA_START.test(f) ? `'${f}` : f
}

/**
 * CSV RFC 4180 untuk file unduhan. Sel formula dinetralkan
 * (`neutralizeCsvCell`) sebelum di-quote — sehingga sel seperti `-abc`
 * menjadi `'-abc` dan tidak lagi round-trip persis lewat `parseCsv`.
 */
export function toCsv(rows: string[][]): string {
  return rows
    .map((r) =>
      r
        .map(neutralizeCsvCell)
        .map((f) => (/[",\r\n]/.test(f) ? `"${f.replaceAll('"', '""')}"` : f))
        .join(","),
    )
    .join("\r\n")
}

export function normalizeMac(mac: string): string | null {
  if (/[^0-9a-f:.\-\s]/i.test(mac)) return null
  const hex = mac
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
  if (hex.length !== 12) return null
  return hex.match(/../g)!.join(":")
}
