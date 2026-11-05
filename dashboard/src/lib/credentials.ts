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

export function generatePassword(length = 16): string {
  const out: string[] = []
  const buf = new Uint32Array(length * 2)
  // Rejection sampling agar distribusi karakter seragam.
  const limit = Math.floor(0x100000000 / ALPHABET.length) * ALPHABET.length
  while (out.length < length) {
    crypto.getRandomValues(buf)
    for (const v of buf) {
      if (v < limit) out.push(ALPHABET[v % ALPHABET.length])
      if (out.length === length) break
    }
  }
  return out.join("")
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

export function toCsv(rows: string[][]): string {
  return rows
    .map((r) =>
      r
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
