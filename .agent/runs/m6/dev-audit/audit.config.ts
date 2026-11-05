// Audit mandiri frontend-dev M6 (bukan suite resmi; test-engineer mengadaptasi ke e2e/m6-ui.spec.ts).
// Server `next start` atas build produksi, DB sementara (seed demo + job sintetis), media palsu,
// password admin acak per run (hanya di memori/env proses; tidak ditulis ke log/file).
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { defineConfig, devices } from "@playwright/test"

import { openDbAt } from "../../src/lib/server/db"
import { BUILTIN_SOURCES } from "../../src/lib/server/db/seed"
import { hashPasswordSync } from "../../src/lib/server/auth/password"

const PORT = 3190
const root = process.env.AUDIT_ROOT ?? mkdtempSync(path.join(__dirname, "run-"))
const first = !process.env.AUDIT_ROOT
process.env.AUDIT_ROOT = root
const dbFile = path.join(root, "audit.db")
const media = path.join(root, "media")

if (first) {
  process.env.AUDIT_ADMIN_PASSWORD = randomBytes(18).toString("base64url")
  process.env.AUDIT_ADMIN_HASH = hashPasswordSync(process.env.AUDIT_ADMIN_PASSWORD)
  openDbAt(dbFile, "demo").close()
  for (const id of ["ubuntu-24.04", "debian-12", "rocky-9"]) {
    const s = BUILTIN_SOURCES[id].source
    for (const f of [s.kernel, s.initrd]) {
      mkdirSync(path.dirname(path.join(media, f)), { recursive: true })
      writeFileSync(path.join(media, f), "dummy\n")
    }
  }
  // Data stres job: 60 job (paginasi), hostname 63 karakter, job failed + event gabungan.
  const db = new DatabaseSync(dbFile)
  const hosts = db.prepare("SELECT id FROM hosts ORDER BY id").all() as { id: string }[]
  db.prepare("UPDATE hosts SET hostname = ? WHERE id = ?").run(
    "node-rack07-lab-cluster-a-very-long-hostname-without-dots-0001x",
    hosts[0].id,
  )
  const ins = db.prepare(
    `INSERT INTO jobs (id, host_id, os_image_id, status, stages, created_at, updated_at, finished_at, failure_reason, installer_boots)
     VALUES (?, ?, 'ubuntu-24.04', ?, ?, ?, ?, ?, ?, 1)`,
  )
  const ev = db.prepare(
    `INSERT INTO job_events (job_id, seq, at, kind, level, source, message, repeat, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const base = Date.UTC(2026, 10, 6, 0, 0, 0)
  for (let i = 0; i < 60; i++) {
    const at = new Date(base + i * 60_000).toISOString()
    const end = new Date(base + i * 60_000 + 30_000).toISOString()
    const failed = i % 7 === 0
    const id = `job-audit-${String(i).padStart(3, "0")}-${"x".repeat(20)}`
    const stages = JSON.stringify([
      { stage: "booting", at, source: "install" },
      { stage: failed ? "failed" : "done", at: end, source: failed ? "watchdog" : "callback" },
    ])
    ins.run(id, hosts[i % hosts.length].id, failed ? "failed" : "done", stages, at, end, end, failed ? "installer-error" : null)
    ev.run(id, 1, at, "stage", "info", "install", "Job install dibuat", 1, at)
    ev.run(id, 2, at, "system", "warn", "boot-script", `PXE boot ulang ${"/very/long/path/segment".repeat(6)}`, 11, end)
    ev.run(id, 3, end, "installer", "error", "installer", `ERROR ${"A".repeat(300)}`, 1, end)
  }
  db.close()
}

export default defineConfig({
  testDir: __dirname,
  testMatch: /(audit|probe)\.spec\.ts/,
  outputDir: path.join(root, "test-results"),
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 300_000,
  use: { baseURL: `http://localhost:${PORT}`, locale: "id-ID", ...devices["Desktop Chrome"] },
  webServer: {
    command: `npx next start -p ${PORT}`,
    cwd: path.resolve(__dirname, "../.."),
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PXE_DB_PATH: dbFile,
      PXE_SEED: "empty",
      PXE_MEDIA_ROOT: media,
      PXE_ADMIN_USERNAME: "admin-audit",
      PXE_ADMIN_PASSWORD_HASH: process.env.AUDIT_ADMIN_HASH!,
      PXE_API_RATE_PER_MIN: "10000",
      // Sama dengan M4_ENV playwright.config.ts (subnet KVM) agar URL media sebanding dengan E2E resmi.
      PXE_MGMT_CIDR: "10.99.0.0/24",
      PXE_MGMT_GATEWAY: "10.99.0.1",
      PXE_MGMT_DNS: "10.99.0.2",
      PXE_SERVER_IP: "10.99.0.2",
      PXE_DYNAMIC_RANGE: "10.99.0.100-10.99.0.200",
      PXE_DHCP_INTERFACE: "pxe0",
    },
  },
})
