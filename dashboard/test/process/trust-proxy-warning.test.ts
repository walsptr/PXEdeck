// Uji level proses SR-6-3 / CR-6-6 (M6 iterasi 2, DEC-022 §3): build standalone (`server.js` memaksa
// NODE_ENV=production) tanpa PXE_TRUST_PROXY=1 → start TETAP jalan (GET /login 200) dan mencetak tepat
// satu baris `[pxe] peringatan: NODE_ENV=production tanpa PXE_TRUST_PROXY=1 …`; dengan
// PXE_TRUST_PROXY=1 (+ file lease, DEC-013) baris itu tidak ada. Hash admin acak saat runtime.
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { hashPasswordSync } from "../../src/lib/server/auth/password"

import { DASHBOARD, SERVER_JS } from "./global-setup"

const HASH = hashPasswordSync(randomBytes(18).toString("base64url"), { logN: 14, r: 8, p: 1 })
const ADMIN = { PXE_ADMIN_USERNAME: "procadmin", PXE_ADMIN_PASSWORD_HASH: HASH }
const WARNING = "[pxe] peringatan: NODE_ENV=production tanpa PXE_TRUST_PROXY=1"

const ROOT = (() => {
  const dir = path.join(DASHBOARD, ".e2e-data")
  mkdirSync(dir, { recursive: true })
  return mkdtempSync(path.join(dir, "process-proxy-"))
})()
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

let port = 3340

/** Jalankan server standalone, tunggu GET /login 200 (maks 30 dtk), lalu matikan. */
async function startAndStop(env: Record<string, string>): Promise<{ output: string; loginStatus?: number }> {
  const p = port++
  const full = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    PORT: String(p),
    HOSTNAME: "127.0.0.1",
    NEXT_TELEMETRY_DISABLED: "1",
    PXE_DB_PATH: path.join(ROOT, `db-${p}.db`),
    ...env,
  }
  const child = spawn(process.execPath, [SERVER_JS], { cwd: path.dirname(SERVER_JS), env: full as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  child.stdout.on("data", (d) => (output += d))
  child.stderr.on("data", (d) => (output += d))
  let dead = false
  const exited = new Promise<void>((resolve) => child.on("exit", () => ((dead = true), resolve())))
  let loginStatus: number | undefined
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
  const alive = !dead
  child.kill("SIGTERM")
  await exited
  return { output, loginStatus: alive ? loginStatus : undefined }
}

describe("SR-6-3 / CR-6-6 peringatan start production tanpa PXE_TRUST_PROXY=1 (proses)", () => {
  it("tanpa PXE_TRUST_PROXY → start (GET /login 200) + tepat satu baris peringatan, tanpa hash", async () => {
    const r = await startAndStop(ADMIN)
    expect(r.loginStatus, r.output.slice(-400)).toBe(200)
    const lines = r.output.split("\n").filter((l) => l.includes(WARNING))
    expect(lines, r.output.slice(-400)).toHaveLength(1)
    expect(lines[0]).toMatch(/batas login per IP berlaku global/)
    expect(r.output).not.toContain("[pxe] start ditolak:")
    expect(r.output).not.toContain(HASH)
  })
  it("PXE_TRUST_PROXY=1 + file lease → start tanpa peringatan proxy", async () => {
    const leases = path.join(ROOT, "dnsmasq.leases")
    writeFileSync(leases, "")
    const r = await startAndStop({ ...ADMIN, PXE_TRUST_PROXY: "1", PXE_DNSMASQ_LEASES: leases })
    expect(r.loginStatus, r.output.slice(-400)).toBe(200)
    expect(r.output).not.toContain("PXE_TRUST_PROXY=1 —")
    expect(r.output).not.toContain("[pxe] peringatan:")
    expect(r.output).not.toContain(HASH)
  })
})
