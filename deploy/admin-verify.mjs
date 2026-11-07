#!/usr/bin/env node
// deploy/admin-verify.mjs — dipakai install.sh saat dijalankan ulang dengan sumber password admin:
// cek apakah password cocok dengan hash scrypt yang sudah ada di /etc/pxe-dashboard.env. Cocok -> hash
// lama dipertahankan (tanpa salt baru, env tidak ditulis ulang, dashboard tidak di-restart).
//
// Input HANYA lewat stdin (tidak pernah argv): baris 1 = hash `scrypt$N$r$p$salt$hash` (N = log2 atau
// nilai penuh, sama dengan dashboard/src/lib/server/auth/password.ts), sisa = password (satu akhiran
// baris dibuang). Tidak mencetak apa pun selain pesan error umum.
// Exit: 0 cocok · 1 tidak cocok · 2 input/format tidak valid.
import crypto from "node:crypto"
import process from "node:process"

function fail(code) {
  process.exit(code)
}

const chunks = []
let size = 0
for await (const c of process.stdin) {
  size += c.length
  if (size > 64 * 1024) fail(2)
  chunks.push(c)
}
const raw = Buffer.concat(chunks).toString("utf8")
const nl = raw.indexOf("\n")
if (nl < 0) fail(2)
const hash = raw.slice(0, nl).replace(/\r$/, "")
const password = raw.slice(nl + 1).replace(/\r?\n$/, "")
const m = /^scrypt\$(\d{1,7})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9+/_=-]{16,})\$([A-Za-z0-9+/_=-]{16,})$/.exec(hash)
if (!m) fail(2)
const nRaw = Number(m[1])
const N = nRaw <= 64 ? 2 ** nRaw : nRaw
const r = Number(m[2])
const p = Number(m[3])
if (!Number.isInteger(Math.log2(N)) || N < 2 ** 10 || N > 2 ** 20 || r < 1 || p < 1) fail(2)
const salt = Buffer.from(m[4], "base64")
const want = Buffer.from(m[5], "base64")
if (want.length < 16 || want.length > 128) fail(2)
let got
try {
  got = crypto.scryptSync(password.normalize("NFC"), salt, want.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r + 1024 * 1024,
  })
} catch {
  fail(2)
}
fail(crypto.timingSafeEqual(got, want) ? 0 : 1)
