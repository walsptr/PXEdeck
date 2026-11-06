// Design-reviewer M6 iter2: audit read-only atas build produksi (.next) dengan DB sementara.
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import path from "node:path"
import { defineConfig, devices } from "@playwright/test"
import { openDbAt } from "../../../../../dashboard/src/lib/server/db"
import { BUILTIN_SOURCES } from "../../../../../dashboard/src/lib/server/db/seed"
import { hashPasswordSync } from "../../../../../dashboard/src/lib/server/auth/password"
import { seedM6Iter2 } from "../../../../../dashboard/e2e/support/m6-iter2-seed"

const PORT = 3194
const root = process.env.DR_ROOT ?? mkdtempSync(path.join(process.env.DR_TMP!, "dr-"))
const first = !process.env.DR_ROOT
process.env.DR_ROOT = root
process.env.PXE_E2E_ROOT = root
const dbFile = path.join(root, "dr.db")
const media = path.join(root, "media")
if (first) {
  process.env.DR_PASS = randomBytes(18).toString("base64url")
  process.env.DR_HASH = hashPasswordSync(process.env.DR_PASS)
  openDbAt(dbFile, "demo").close()
  for (const id of ["ubuntu-24.04", "debian-12", "rocky-9"]) {
    const s = BUILTIN_SOURCES[id].source
    for (const f of [s.kernel, s.initrd]) {
      mkdirSync(path.dirname(path.join(media, f)), { recursive: true })
      writeFileSync(path.join(media, f), "dummy\n")
    }
  }
  seedM6Iter2(dbFile)
}
export default defineConfig({
  testDir: __dirname,
  testMatch: process.env.DR_SPEC ? new RegExp(process.env.DR_SPEC) : /dr\.spec\.ts/,
  outputDir: path.join(root, "test-results"),
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 600_000,
  use: { baseURL: `http://localhost:${PORT}`, locale: "id-ID", ...devices["Desktop Chrome"] },
  webServer: {
    command: `npx next start -p ${PORT}`,
    cwd: path.resolve(__dirname, "../../../../../dashboard"),
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PXE_DB_PATH: dbFile, PXE_SEED: "empty", PXE_MEDIA_ROOT: media,
      PXE_ADMIN_USERNAME: "admin-dr", PXE_ADMIN_PASSWORD_HASH: process.env.DR_HASH!,
      PXE_API_RATE_PER_MIN: "10000", PXE_E2E_ROOT: root,
      PXE_MGMT_CIDR: "10.99.0.0/24", PXE_MGMT_GATEWAY: "10.99.0.1", PXE_MGMT_DNS: "10.99.0.2",
      PXE_SERVER_IP: "10.99.0.2", PXE_DYNAMIC_RANGE: "10.99.0.100-10.99.0.200", PXE_DHCP_INTERFACE: "pxe0",
    },
  },
})
