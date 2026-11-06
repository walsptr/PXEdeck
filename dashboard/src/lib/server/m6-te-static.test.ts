// M6-T10/T11 (test-engineer) — AC-6.53 (static): dokumentasi asumsi keamanan, `.env.example` tanpa
// hash nyata, dan tidak ada hash scrypt nyata di repo (HEAD + working tree).
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const DASH = path.resolve(__dirname, "../../..")
const REPO = path.resolve(DASH, "..")
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8")

describe("AC-6.53 infra/README.md §Asumsi keamanan", () => {
  const readme = read("infra/README.md")
  const section = readme.split(/^## /m).find((s) => s.startsWith("Asumsi keamanan")) ?? ""

  it("bagian ada dan memuat LAN terisolasi, HTTP polos, cookie tanpa Secure di lab, login + rate limit + allowlist, sisa risiko SR-4-7(b)", () => {
    expect(section).not.toBe("")
    for (const re of [
      /LAN provisioning terisolasi/,
      /HTTP polos/,
      /Cookie sesi tanpa `Secure`/,
      /HttpOnly/,
      /SameSite=Strict/,
      /allowlist IP nginx/,
      /login admin wajib/,
      /rate limit/,
      /limit_req/,
      /SR-4-7\(b\)/,
      /token/,
    ])
      expect(section, String(re)).toMatch(re)
  })
})

describe("AC-6.53 .env.example", () => {
  const text = readFileSync(path.join(DASH, ".env.example"), "utf8")
  const vars = Object.fromEntries(
    text
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  )

  it("semua variabel plan §2.1 ada dengan nilai kosong/default (tanpa hash)", () => {
    expect(vars).toMatchObject({
      PXE_ADMIN_USERNAME: "",
      PXE_ADMIN_PASSWORD_HASH: "",
      PXE_SESSION_IDLE_MIN: "120",
      PXE_SESSION_MAX_HOURS: "12",
      PXE_LOGIN_MAX_FAILURES: "5",
      PXE_LOGIN_WINDOW_MIN: "15",
      PXE_API_RATE_PER_MIN: "600",
      PXE_INSECURE_NO_LEASE_CHECK_CONFIRM: "",
    })
    expect(text).not.toMatch(/scrypt\$\d/)
    expect(text).not.toMatch(/\$6\$[A-Za-z0-9./]{4,}/)
  })

  it("peringatan PXE_INSECURE_NO_LEASE_CHECK_CONFIRM: frasa, production, jangan diisi di server sungguhan", () => {
    const i = text.indexOf("PXE_INSECURE_NO_LEASE_CHECK_CONFIRM=")
    const comment = text.slice(text.lastIndexOf("\n\n", i), i)
    expect(comment).toMatch(/I_UNDERSTAND_CONFIG_LEAKS/)
    expect(comment).toMatch(/NODE_ENV=production/)
    expect(comment).toMatch(/JANGAN/)
  })
})

/** Hash scrypt lengkap (`scrypt$N$r$p$salt$hash`). */
const FULL_HASH_RE = "scrypt\\$[0-9]{1,7}\\$[0-9]{1,3}\\$[0-9]{1,3}\\$[A-Za-z0-9+/]{16,}={0,2}\\$[A-Za-z0-9+/]{40,}={0,2}"

/**
 * Hash sintetis bertanda: berada di file test DAN badan hash ter-decode seluruhnya ASCII cetak (keluaran
 * scrypt nyata = 64 byte acak; peluang semuanya ASCII cetak ≈ (95/256)^64, praktis nol).
 */
function isMarkedSynthetic(file: string, hash: string): boolean {
  const isTestFile = /(^|\/)(test|tests|fixtures)\/|\.test\.tsx?$|e2e\//.test(file)
  const body = Buffer.from(hash.split("$")[5], "base64")
  return isTestFile && body.length > 0 && [...body].every((b) => b >= 0x20 && b < 0x7f)
}

function gitGrep(args: string[]): string[] {
  try {
    return execFileSync("git", ["grep", "-nIoE", FULL_HASH_RE, ...args], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
  } catch (e) {
    // exit 1 = tidak ada yang cocok
    if ((e as { status?: number }).status === 1) return []
    throw e
  }
}

describe("AC-6.53 git grep: tanpa hash scrypt nyata", () => {
  it.each([
    ["HEAD", ["HEAD"]],
    ["working tree (file terlacak)", []],
  ])("%s: setiap hash scrypt lengkap hanya fixture uji bertanda", (_n, args) => {
    const hits = gitGrep(args).map((l) => {
      const parts = l.replace(/^HEAD:/, "").split(":")
      return { file: parts[0], hash: parts.slice(2).join(":") }
    })
    const real = hits.filter((h) => !isMarkedSynthetic(h.file, h.hash))
    expect(real.map((h) => h.file)).toEqual([])
  })

  it("kontrol: pemeriksa menolak hash berbentuk nyata (badan acak) walau di file test, dan hash sintetis di luar file test", () => {
    const random = `scrypt$15$8$1$${Buffer.alloc(16, 7).toString("base64")}$${Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 97 + 13) % 256)).toString("base64")}`
    expect(new RegExp(FULL_HASH_RE).test(random)).toBe(true)
    expect(isMarkedSynthetic("dashboard/src/x.test.ts", random)).toBe(false)
    const synthetic = `scrypt$15$8$1$c2FsdHNhbHRzYWx0c2FsdA$${Buffer.from("hash".repeat(16)).toString("base64")}`
    expect(isMarkedSynthetic("infra/test/m6.sh", synthetic)).toBe(true)
    expect(isMarkedSynthetic("infra/server/dashboard.env", synthetic)).toBe(false)
  })
})
