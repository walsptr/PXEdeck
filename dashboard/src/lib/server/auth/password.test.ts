// M6-T1/T2 (backend-dev): hash password scrypt (AC-6.4) + paritas helper `npm run admin:hash`.
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ADMIN_PASSWORD_MAX,
  ADMIN_PASSWORD_MIN,
  hashPassword,
  hashPasswordSync,
  parsePasswordHash,
  passwordHashProblem,
  safeEqualString,
  SCRYPT_DEFAULT,
  scryptMaxmem,
  verifyDummy,
  verifyPassword,
} from "./password"

const FAST = { logN: 14, r: 8, p: 1 }
const SCRIPT = path.resolve(__dirname, "../../../../scripts/admin-hash.mjs")
const PW = `pw-${crypto.randomBytes(9).toString("base64url")}`

/** Ganti satu bagian hash (dipisah "$") — untuk kasus parameter rusak. */
function withPart(encoded: string, i: number, v: string): string {
  const p = encoded.split("$")
  p[i] = v
  return p.join("$")
}

function runHelper(input: string) {
  return spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8", timeout: 30_000 })
}

afterEach(() => vi.restoreAllMocks())

describe("hashPassword / verifyPassword (AC-6.4)", () => {
  it("round-trip; password salah → false; format ber-parameter default N=2^15 r=8 p=1", async () => {
    const h = await hashPassword(PW)
    const parts = h.split("$")
    expect(parts.slice(0, 4)).toEqual(["scrypt", "15", "8", "1"])
    expect(Buffer.from(parts[4], "base64")).toHaveLength(16)
    expect(Buffer.from(parts[5], "base64")).toHaveLength(64)
    expect(await verifyPassword(PW, h)).toBe(true)
    expect(await verifyPassword(`${PW}x`, h)).toBe(false)
    expect(await verifyPassword("", h)).toBe(false)
    // Salt acak: dua hash berbeda untuk password yang sama.
    expect(await hashPassword(PW)).not.toBe(h)
  })

  it("normalisasi NFC: bentuk komposisi berbeda dari password yang sama tetap cocok", async () => {
    const h = hashPasswordSync("café-password-1", FAST)
    expect(await verifyPassword("café-password-1", h)).toBe(true)
  })

  it("hash rusak / parameter di luar batas → false tanpa melempar", async () => {
    const h = hashPasswordSync(PW, FAST)
    const bad = [
      withPart(h, 1, "13"),
      withPart(h, 1, "21"),
      withPart(h, 1, "014"),
      withPart(h, 2, "0"),
      withPart(h, 2, "17"),
      withPart(h, 3, "0"),
      withPart(h, 3, "5"),
      withPart(h, 0, "bcrypt"),
      withPart(h, 4, Buffer.alloc(15).toString("base64")),
      withPart(h, 5, Buffer.alloc(32).toString("base64")),
      withPart(h, 5, Buffer.alloc(65).toString("base64")),
      withPart(h, 5, "!!!"),
      h.split("$").slice(0, 5).join("$"),
      `${h}$x`,
      "",
      "x".repeat(600),
    ]
    for (const b of bad) {
      expect(parsePasswordHash(b), b).toBeNull()
      expect(passwordHashProblem(b), b).toMatch(/format tidak valid/)
      await expect(verifyPassword(PW, b)).resolves.toBe(false)
    }
    await expect(verifyPassword(PW, null)).resolves.toBe(false)
    await expect(verifyPassword(PW, undefined)).resolves.toBe(false)
    expect(passwordHashProblem(h)).toBeNull()
    // Batas atas diterima parser (tanpa menjalankan scrypt 2^20).
    expect(parsePasswordHash(withPart(withPart(withPart(h, 1, "20"), 2, "16"), 3, "4"))).toMatchObject({ logN: 20, r: 16, p: 4 })
  })

  it("pesan masalah hash tidak memuat nilai hash", () => {
    const h = withPart(hashPasswordSync(PW, FAST), 1, "21")
    const msg = passwordHashProblem(h)!
    for (const part of h.split("$").slice(4)) expect(msg).not.toContain(part)
  })

  it("perbandingan memakai crypto.timingSafeEqual (spy)", async () => {
    const h = hashPasswordSync(PW, FAST)
    const spy = vi.spyOn(crypto, "timingSafeEqual")
    expect(await verifyPassword(PW, h)).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("verifyDummy (username tak dikenal) tetap menjalankan scrypt dengan parameter yang diberikan, selalu false", async () => {
    const spy = vi.spyOn(crypto, "scrypt")
    expect(await verifyDummy(PW, FAST)).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][3]).toMatchObject({ N: 2 ** 14, r: 8, p: 1, maxmem: scryptMaxmem(FAST) })
    // Default = parameter default app.
    expect(await verifyDummy(PW)).toBe(false)
    expect(spy.mock.calls[1][3]).toMatchObject({ N: 2 ** SCRYPT_DEFAULT.logN })
  })

  it("verifyDummy tidak melempar walau scrypt gagal", async () => {
    vi.spyOn(crypto, "scrypt").mockImplementation(((...a: unknown[]) => {
      ;(a.at(-1) as (e: Error | null) => void)(new Error("boom"))
    }) as unknown as typeof crypto.scrypt)
    expect(await verifyDummy(PW, FAST)).toBe(false)
    expect(await verifyPassword(PW, hashPasswordSync(PW, FAST))).toBe(false)
  })

  it("maxmem eksplisit = 128·N·r + 1 MiB", () => {
    expect(scryptMaxmem({ logN: 15, r: 8, p: 1 })).toBe(128 * 32768 * 8 + 1024 * 1024)
  })

  it("safeEqualString: sama/beda/panjang beda", () => {
    expect(safeEqualString("admin", "admin")).toBe(true)
    expect(safeEqualString("admin", "Admin")).toBe(false)
    expect(safeEqualString("admin", "admin2")).toBe(false)
  })
})

describe("scripts/admin-hash.mjs (npm run admin:hash) — paritas dua arah", () => {
  it("hash helper (stdin) diverifikasi app; hash app sama formatnya; password tidak dicetak", async () => {
    const r = runHelper(`${PW}\n`)
    expect(r.status).toBe(0)
    const out = r.stdout.trim()
    expect(out.split("\n")).toHaveLength(1)
    expect(parsePasswordHash(out)).toMatchObject(SCRYPT_DEFAULT)
    expect(await verifyPassword(PW, out)).toBe(true)
    expect(await verifyPassword(`${PW}!`, out)).toBe(false)
    expect(r.stdout + r.stderr).not.toContain(PW)
    // Arah sebaliknya: hash app punya bentuk yang sama dengan keluaran helper.
    const app = await hashPassword(PW)
    expect(app.split("$").slice(0, 4)).toEqual(out.split("$").slice(0, 4))
    expect(app.split("$").map((x) => x.length)).toEqual(out.split("$").map((x) => x.length))
  })

  it("verifikasi silang dengan implementasi helper: hash app dihitung ulang memakai rumus helper", async () => {
    // Rumus helper (scryptSync NFC, keylen 64) atas salt dari hash app → harus sama dengan hash app.
    const app = await hashPassword(PW)
    const [, n, rr, pp, salt, hash] = app.split("$")
    const N = 2 ** Number(n)
    const key = crypto.scryptSync(PW.normalize("NFC"), Buffer.from(salt, "base64"), 64, {
      N,
      r: Number(rr),
      p: Number(pp),
      maxmem: 128 * N * Number(rr) + 1024 * 1024,
    })
    expect(key.toString("base64")).toBe(hash)
  })

  it("tolak < 12 / > 256 karakter dan multi-baris (exit 2), tanpa mencetak password", () => {
    const short = "a".repeat(ADMIN_PASSWORD_MIN - 1)
    const long = "b".repeat(ADMIN_PASSWORD_MAX + 1)
    for (const input of [short, long, `${"c".repeat(12)}\nsecond-line-xx`]) {
      const r = runHelper(input)
      expect(r.status).toBe(2)
      expect(r.stdout).toBe("")
      expect(r.stderr).toMatch(/^admin:hash: /)
      expect(r.stderr).not.toContain(input.slice(0, 12))
    }
    // Batas tepat diterima.
    expect(runHelper("d".repeat(ADMIN_PASSWORD_MIN)).status).toBe(0)
    expect(runHelper("e".repeat(ADMIN_PASSWORD_MAX)).status).toBe(0)
  })
})
