#!/usr/bin/env node
// `npm run admin:hash` (M6-T1, DEC-017 §3): baca password admin dari stdin (TTY tanpa echo, atau
// pipe), tolak < 12 / > 256 karakter, cetak HANYA hash ke stdout (satu baris). Password tidak pernah
// dicetak, tidak ada di argv, tidak ditulis ke file.
//
// Implementasi setara `src/lib/server/auth/password.ts` (`hashPassword`: scrypt N=2^15 r=8 p=1,
// salt 16 B, hash 64 B, NFC) — paritas dua arah diuji di `src/lib/server/auth/admin-hash.test.ts`.
// Contoh:  printf '%s' "$PASS" | npm run --silent admin:hash
// Di `.env.local` (Next memperluas $VAR) tulis setiap tanda dolar hash sebagai \$; di systemd
// EnvironmentFile (`/etc/pxe-dashboard.env`) tulis apa adanya.
import crypto from "node:crypto"
import process from "node:process"

const MIN = 12
const MAX = 256
const PARAMS = { logN: 15, r: 8, p: 1 }
const KEYLEN = 64

function fail(msg) {
  process.stderr.write(`admin:hash: ${msg}\n`)
  process.exit(2)
}

function readPiped() {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    process.stdin.on("data", (c) => {
      size += c.length
      if (size > 64 * 1024) reject(new Error("input terlalu besar"))
      else chunks.push(c)
    })
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    process.stdin.on("error", reject)
  })
}

function readTty() {
  return new Promise((resolve) => {
    process.stderr.write("Password admin: ")
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")
    let buf = ""
    const done = (v) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener("data", onData)
      process.stderr.write("\n")
      resolve(v)
    }
    const onData = (s) => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done(buf)
        if (ch === "\u0003") {
          process.stderr.write("\n")
          process.exit(130)
        }
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1)
        else buf += ch
      }
    }
    stdin.on("data", onData)
  })
}

const raw = process.stdin.isTTY ? await readTty() : await readPiped().catch((e) => fail(e.message))
// Pipe: buang SATU akhiran baris (echo/printf "...\n"); baris kedua → tolak.
const password = raw.replace(/\r?\n$/, "")
if (/[\r\n]/.test(password)) fail("password tidak boleh memuat baris baru")
const len = [...password].length
if (len < MIN || len > MAX) fail(`password harus ${MIN}–${MAX} karakter`)

const salt = crypto.randomBytes(16)
const key = crypto.scryptSync(password.normalize("NFC"), salt, KEYLEN, {
  N: 2 ** PARAMS.logN,
  r: PARAMS.r,
  p: PARAMS.p,
  maxmem: 128 * 2 ** PARAMS.logN * PARAMS.r + 1024 * 1024,
})
process.stdout.write(
  ["scrypt", PARAMS.logN, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$") + "\n",
)
