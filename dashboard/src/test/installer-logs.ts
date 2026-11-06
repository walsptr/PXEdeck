// Harness fixture log installer (M6 AC-6.17 / SR-5-5(c)). Fixture berupa TEMPLATE teks: secret
// tidak pernah ditulis ke file, hanya placeholder yang diisi saat test dengan secret SINTETIS:
//   {{MAC}}       MAC host (bukan secret)
//   {{ESC}}       byte ESC (sekuens ANSI di log; bukan secret)
//   {{TOKEN}}     token per-MAC (diisi token job uji — dibuat ulang tiap test, bukan token sungguhan)
//   {{HASH}}      hash SHA-512 crypt sintetis `$6$FIXTURE…` (tidak diturunkan dari password apa pun)
//   {{KEY}}       blok private key OpenSSH sintetis (BEGIN + isi 70 kolom + END; isi = base64 teks
//                 "FIXTURE …", bukan materi key)
//   {{KEY_BODY}}  hanya baris isi key sintetis (tanpa BEGIN/END; CR-5-20b)
// Baris template yang memuat placeholder secret = "baris secret"; baris lain = "baris biasa" yang
// wajib tersimpan identik setelah normalisasi terdokumentasi: `stripControl`, dan — bila body yang
// sama memuat secret sehingga tampilan dirender dari salinan `bare`/`sgr` (`cleanAndRedact`) —
// sekuens ANSI utuh/SGR boleh hilang. Fixture sintetis ada di
// `src/test/installer-logs/synthetic/`; fixture nyata dari run KVM M6 (T14, AC-6.17) memakai format
// template yang sama sehingga cukup ditambahkan ke daftar direktori di test.
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { stripAnsi, stripControl } from "@/lib/server/redact"

export const SYNTHETIC_DIR = path.resolve(__dirname, "installer-logs/synthetic")

export const FIXTURE_HASH = `$6$FIXTUREsalt$${"FIXTUREhashFIXTUREhashFIXTUREhash0123456789./".repeat(2).slice(0, 86)}`
/** Isi key sintetis: base64 teks berlabel FIXTURE, dibungkus 70 kolom seperti OpenSSH. */
export const FIXTURE_KEY_BODY: string[] = (() => {
  const b64 = Buffer.from(
    Array.from({ length: 6 }, (_, i) => `FIXTURE synthetic openssh key material line ${i} not a real key. `).join(""),
  ).toString("base64")
  const out: string[] = []
  for (let i = 0; i < b64.length; i += 70) out.push(b64.slice(i, i + 70))
  return out
})()
export const FIXTURE_KEY = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  ...FIXTURE_KEY_BODY,
  "-----END OPENSSH PRIVATE KEY-----",
]

const SECRET_PH = /\{\{(TOKEN|HASH|KEY|KEY_BODY)\}\}/

export type FixtureLine = { text: string; secret: boolean }

/** Isi template → baris (placeholder KEY/KEY_BODY menjadi beberapa baris secret). */
export function expandTemplate(tpl: string, v: { mac: string; token: string }): FixtureLine[] {
  const out: FixtureLine[] = []
  for (const raw of tpl.replace(/\n$/, "").split("\n")) {
    const secret = SECRET_PH.test(raw)
    if (raw.trim() === "{{KEY}}") {
      for (const l of FIXTURE_KEY) out.push({ text: l, secret: true })
      continue
    }
    if (raw.trim() === "{{KEY_BODY}}") {
      for (const l of FIXTURE_KEY_BODY) out.push({ text: l, secret: true })
      continue
    }
    const text = raw
      .replaceAll("{{MAC}}", v.mac)
      .replaceAll("{{ESC}}", "\x1b")
      .replaceAll("{{TOKEN}}", v.token)
      .replaceAll("{{HASH}}", FIXTURE_HASH)
    out.push({ text, secret })
  }
  return out
}

/** Pecah baris menjadi body request: ≤ `maxLines` baris dan ≤ `maxBytes` byte per body. */
export function chunkBodies(lines: string[], maxLines = 200, maxBytes = 16 * 1024, eol = "\n"): string[] {
  const bodies: string[] = []
  let cur: string[] = []
  let bytes = 0
  for (const l of lines) {
    const b = Buffer.byteLength(l + eol)
    if (cur.length > 0 && (cur.length >= maxLines || bytes + b > maxBytes)) {
      bodies.push(cur.join(eol) + eol)
      cur = []
      bytes = 0
    }
    cur.push(l)
    bytes += b
  }
  if (cur.length) bodies.push(cur.join(eol) + eol)
  return bodies
}

/** Potongan secret yang tidak boleh muncul di pesan tersimpan mana pun. */
export function secretPieces(token: string): string[] {
  const pieces = new Set<string>()
  for (let i = 0; i + 8 <= token.length; i++) pieces.add(token.slice(i, i + 8))
  const hashBody = FIXTURE_HASH.slice(3)
  for (let i = 0; i + 8 <= hashBody.length; i++) pieces.add(hashBody.slice(i, i + 8))
  for (const l of FIXTURE_KEY_BODY) if (l.length >= 16) pieces.add(l.slice(0, 16)).add(l.slice(-16))
  return [...pieces]
}

/**
 * Bandingkan pesan tersimpan dengan fixture: pesan tanpa `[REDACTED` harus sama persis (urutan dan
 * isi) dengan baris biasa setelah `stripControl`; tidak ada potongan secret di pesan mana pun; ada
 * ≥ 1 pesan teredaksi bila fixture memuat baris secret. Mengembalikan daftar masalah (kosong = lulus).
 */
export function checkStored(
  stored: string[],
  lines: FixtureLine[],
  token: string,
  opts: { allowShortKeyTail?: number } = {},
): string[] {
  const problems: string[] = []
  // Sisa risiko terdokumentasi (redact.ts): baris terakhir isi key yang pendek (< 16) dan terpisah
  // ke awal request berikutnya, tanpa BEGIN/END/rangkaian di request itu, tidak bisa dikenali.
  // Hanya diizinkan bila pemanggil menyebut jumlah maksimumnya secara eksplisit.
  let allowance = opts.allowShortKeyTail ?? 0
  const shortTails = new Set(FIXTURE_KEY_BODY.filter((l) => l.length < 16))
  stored = stored.filter((m) => {
    if (allowance > 0 && shortTails.has(m)) {
      allowance--
      return false
    }
    return true
  })
  const pieces = secretPieces(token)
  for (const m of stored) {
    const leak = pieces.find((p) => m.includes(p))
    if (leak) problems.push(`bocor ${JSON.stringify(leak)} di ${JSON.stringify(m)}`)
  }
  const sgr = (t: string) => t.replace(/\x1b\[[0-9;:]*m|\x9b[0-9;:]*m|\x1b\]8;[^\x07\x1b\n]*(?:\x07|\x1b\\)/g, "")
  const expected = lines
    .filter((l) => !l.secret)
    .map((l) => l.text.replaceAll("\r", ""))
    .filter((l) => stripControl(l).trim() !== "")
    .map((l) => new Set([stripControl(l), stripControl(stripAnsi(l)), stripControl(sgr(l))]))
  const plain = stored.filter((m) => !m.includes("[REDACTED"))
  const n = Math.max(expected.length, plain.length)
  for (let i = 0; i < n; i++) {
    if (!expected[i] || plain[i] === undefined || !expected[i].has(plain[i])) {
      problems.push(`baris biasa ke-${i}: diharapkan ${JSON.stringify(expected[i] && [...expected[i]])}, tersimpan ${JSON.stringify(plain[i])}`)
      break
    }
  }
  if (lines.some((l) => l.secret) && plain.length === stored.length) problems.push("tidak ada pesan teredaksi")
  return problems
}

/** Template `*.log` di `dir` (urut nama). */
export function listFixtures(dir: string): { name: string; template: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".log"))
    .sort()
    .map((f) => ({ name: f, template: readFileSync(path.join(dir, f), "utf8") }))
}
