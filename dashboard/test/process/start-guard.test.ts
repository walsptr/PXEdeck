// Uji level proses penolakan start (M6-T11, plan §2.9): AC-6.2 (O3, admin wajib di production), AC-6.3
// (SR-5-4 / DEC-016 §2 flag insecure + konfirmasi; SR-5-10 PXE_TRUST_PROXY=1 tanpa PXE_DNSMASQ_LEASES).
// Menjalankan build standalone `.next/standalone/server.js` (bentuk deploy; server.js memaksa
// NODE_ENV=production) sebagai proses anak dengan env buruk → exit ≠ 0 ≤ 15 dtk, stderr memuat
// `[pxe] start ditolak:` + nama variabel, tanpa nilai hash. Env baik → `GET /login` 200 lalu dimatikan.
// Password/hash dibuat acak saat runtime; tidak ada nilai rahasia di repo atau output test.
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { hashPasswordSync } from "../../src/lib/server/auth/password"

import { DASHBOARD, SERVER_JS } from "./global-setup"

const PHRASE = "I_UNDERSTAND_CONFIG_LEAKS"
const PASSWORD = randomBytes(18).toString("base64url")
const HASH = hashPasswordSync(PASSWORD, { logN: 14, r: 8, p: 1 })
/** Hash berformat benar tetapi logN 21 (di luar batas 14–20). */
const HASH_LOGN21 = HASH.replace(/^scrypt\$14\$/, "scrypt$21$")

const ROOT = (() => {
  const dir = path.join(DASHBOARD, ".e2e-data")
  mkdirSync(dir, { recursive: true })
  return mkdtempSync(path.join(dir, "process-"))
})()
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

let port = 3290
let dbN = 0

type Run = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; loginStatus?: number }

/**
 * Jalankan server standalone dengan `env` (di atas env minimal). Bila proses tetap hidup, tunggu
 * `GET /login` lalu matikan. Batas 15 dtk untuk keluar sendiri (AC-6.2/6.3).
 */
async function runServer(env: Record<string, string | undefined>, opts: { expectExit: boolean }): Promise<Run> {
  const p = port++
  const db = path.join(ROOT, `db-${dbN++}.db`)
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    PORT: String(p),
    HOSTNAME: "127.0.0.1",
    NEXT_TELEMETRY_DISABLED: "1",
    PXE_DB_PATH: db,
  }
  const full: Record<string, string> = { ...base }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) full[k] = v
  const started = Date.now()
  const child = spawn(process.execPath, [SERVER_JS], { cwd: path.dirname(SERVER_JS), env: full as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (d) => (stdout += d))
  child.stderr.on("data", (d) => (stderr += d))
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.on("exit", (code, signal) => resolve({ code, signal })),
  )
  if (opts.expectExit) {
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 15_000))
    const r = await Promise.race([exited, timeout])
    if (r === "timeout") {
      child.kill("SIGKILL")
      await exited
      return { code: null, signal: null, stdout, stderr, ms: Date.now() - started }
    }
    return { ...r, stdout, stderr, ms: Date.now() - started }
  }
  // Server diharapkan hidup: polling GET /login sampai 200 (maks 30 dtk) atau proses keluar.
  let loginStatus: number | undefined
  let dead = false
  void exited.then(() => (dead = true))
  const deadline = Date.now() + 30_000
  while (!dead && Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/login`)
      loginStatus = res.status
      if (res.status === 200) break
    } catch {
      // belum listen
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  const aliveAfterLogin = !dead
  child.kill("SIGTERM")
  const r = await exited
  return { ...r, stdout, stderr, ms: Date.now() - started, loginStatus: aliveAfterLogin ? loginStatus : undefined }
}

const ADMIN = { PXE_ADMIN_USERNAME: "procadmin", PXE_ADMIN_PASSWORD_HASH: HASH }

/** Asersi umum penolakan start. */
function expectRejected(r: Run, vars: string[], secrets: string[] = []) {
  expect(r.code, `harus keluar sendiri ≤ 15 dtk (stderr: ${r.stderr.slice(-400)})`).not.toBeNull()
  expect(r.code).not.toBe(0)
  expect(r.ms).toBeLessThanOrEqual(15_000)
  const line = r.stderr.split("\n").find((l) => l.includes("[pxe] start ditolak:"))
  expect(line, `stderr tanpa baris penolakan: ${r.stderr.slice(-400)}`).toBeDefined()
  for (const v of vars) expect(line).toContain(v)
  for (const s of [...secrets, PASSWORD]) {
    expect(r.stderr).not.toContain(s)
    expect(r.stdout).not.toContain(s)
  }
  expect(r.stderr + r.stdout).not.toMatch(/scrypt\$\d/)
}

describe("AC-6.2 production tanpa admin valid → start ditolak (proses)", () => {
  it("tanpa PXE_ADMIN_USERNAME", async () => {
    expectRejected(await runServer({ PXE_ADMIN_PASSWORD_HASH: HASH }, { expectExit: true }), ["PXE_ADMIN_USERNAME"], [HASH])
  })
  it("tanpa PXE_ADMIN_PASSWORD_HASH", async () => {
    expectRejected(await runServer({ PXE_ADMIN_USERNAME: "procadmin" }, { expectExit: true }), ["PXE_ADMIN_PASSWORD_HASH"])
  })
  it("hash format salah", async () => {
    const bad = `scrypt$15$8$1$${"QUJD".repeat(4)}$pendek`
    expectRejected(await runServer({ PXE_ADMIN_USERNAME: "procadmin", PXE_ADMIN_PASSWORD_HASH: bad }, { expectExit: true }), ["PXE_ADMIN_PASSWORD_HASH"], [bad])
  })
  it("logN=21 (di luar batas)", async () => {
    expectRejected(
      await runServer({ PXE_ADMIN_USERNAME: "procadmin", PXE_ADMIN_PASSWORD_HASH: HASH_LOGN21 }, { expectExit: true }),
      ["PXE_ADMIN_PASSWORD_HASH"],
      [HASH_LOGN21, HASH_LOGN21.split("$")[5]],
    )
  })
  it("username admin tidak valid", async () => {
    expectRejected(await runServer({ PXE_ADMIN_USERNAME: "Admin Root", PXE_ADMIN_PASSWORD_HASH: HASH }, { expectExit: true }), ["PXE_ADMIN_USERNAME"], [HASH])
  })
})

describe("AC-6.3 SR-5-4 / DEC-016 §2: production + PXE_INSECURE_NO_LEASE_CHECK=1 (proses)", () => {
  const VARS = ["PXE_INSECURE_NO_LEASE_CHECK", "PXE_INSECURE_NO_LEASE_CHECK_CONFIRM"]
  it("tanpa konfirmasi → ditolak, pesan menyebut kedua variabel", async () => {
    expectRejected(await runServer({ ...ADMIN, PXE_INSECURE_NO_LEASE_CHECK: "1" }, { expectExit: true }), VARS, [HASH])
  })
  it.each([
    ["yes", "yes"],
    ["huruf kecil", PHRASE.toLowerCase()],
    ["berspasi", ` ${PHRASE} `],
    ["frasa beda", "I_UNDERSTAND"],
  ])("konfirmasi %s → ditolak", async (_n, confirm) => {
    expectRejected(
      await runServer({ ...ADMIN, PXE_INSECURE_NO_LEASE_CHECK: "1", PXE_INSECURE_NO_LEASE_CHECK_CONFIRM: confirm }, { expectExit: true }),
      VARS,
      [HASH],
    )
  })
  it("frasa tepat → start (GET /login 200) + peringatan", async () => {
    const r = await runServer({ ...ADMIN, PXE_INSECURE_NO_LEASE_CHECK: "1", PXE_INSECURE_NO_LEASE_CHECK_CONFIRM: PHRASE }, { expectExit: false })
    expect(r.loginStatus, r.stderr.slice(-400)).toBe(200)
    expect(r.stderr + r.stdout).toMatch(/\[pxe\].*PXE_INSECURE_NO_LEASE_CHECK/)
    expect(r.stderr + r.stdout).not.toContain("[pxe] start ditolak:")
    expect(r.stderr + r.stdout).not.toContain(HASH)
  })
})

describe("SR-5-10 / AC-6.3 PXE_TRUST_PROXY=1 tanpa PXE_DNSMASQ_LEASES (proses)", () => {
  it("exit ≠ 0 + baris penolakan menyebut variabel", async () => {
    expectRejected(await runServer({ ...ADMIN, PXE_TRUST_PROXY: "1" }, { expectExit: true }), ["PXE_DNSMASQ_LEASES"], [HASH])
  })
})

describe("kontrol positif: env baik", () => {
  it("production + admin valid → GET /login 200, tanpa penolakan, tanpa hash di output", async () => {
    const r = await runServer(ADMIN, { expectExit: false })
    expect(r.loginStatus, r.stderr.slice(-400)).toBe(200)
    expect(r.stderr + r.stdout).not.toContain("[pxe] start ditolak:")
    expect(r.stderr + r.stdout).not.toContain(HASH)
  })
})
