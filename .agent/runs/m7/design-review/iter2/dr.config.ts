// Design-reviewer M7 iter2 (salinan iter1, path disesuaikan, satu server VLAN): audit read-only atas build produksi (.next) dengan DB sementara.
// Dua server: :3195 dengan PXE_VLAN_NETWORKS (project "vlan"), :3196 tanpa env (project "novlan").
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import path from "node:path"
import { defineConfig, devices } from "@playwright/test"
import { openDbAt } from "../../../../../dashboard/src/lib/server/db"
import { BUILTIN_SOURCES } from "../../../../../dashboard/src/lib/server/db/seed"
import { hashPasswordSync } from "../../../../../dashboard/src/lib/server/auth/password"

const root = process.env.DR_ROOT ?? mkdtempSync(path.join(process.env.DR_TMP!, "dr-"))
const first = !process.env.DR_ROOT
process.env.DR_ROOT = root
process.env.PXE_E2E_ROOT = root
const media = path.join(root, "media")
const db = (n: string) => path.join(root, `${n}.db`)
if (first) {
  process.env.DR_PASS = randomBytes(18).toString("base64url")
  process.env.DR_HASH = hashPasswordSync(process.env.DR_PASS)
  for (const n of ["vlan", "novlan"]) openDbAt(db(n), "demo").close()
  for (const id of ["ubuntu-24.04", "debian-12", "rocky-9"]) {
    const s = BUILTIN_SOURCES[id].source
    for (const f of [s.kernel, s.initrd]) {
      mkdirSync(path.dirname(path.join(media, f)), { recursive: true })
      writeFileSync(path.join(media, f), "dummy\n")
    }
  }
}
const base = (n: string) => ({
  PXE_DB_PATH: db(n), PXE_SEED: "empty", PXE_MEDIA_ROOT: media,
  PXE_ADMIN_USERNAME: "admin-dr", PXE_ADMIN_PASSWORD_HASH: process.env.DR_HASH!,
  PXE_API_RATE_PER_MIN: "10000", PXE_E2E_ROOT: root,
  PXE_MGMT_CIDR: "10.10.10.0/24", PXE_MGMT_GATEWAY: "10.10.10.1", PXE_MGMT_DNS: "10.10.10.1",
  PXE_SERVER_IP: "10.10.10.1", PXE_DYNAMIC_RANGE: "10.10.10.100-10.10.10.200",
})
const cwd = path.resolve(__dirname, "../../../../../dashboard")
export default defineConfig({
  testDir: __dirname,
  outputDir: path.join(root, "test-results"),
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 600_000,
  use: { locale: "id-ID", ...devices["Desktop Chrome"] },
  projects: [
    { name: "vlan", testMatch: process.env.DR_SPEC ? new RegExp(process.env.DR_SPEC) : /dr-iter2\.spec\.ts/, use: { baseURL: "http://localhost:3195" } },
  ],
  webServer: [
    { command: "npx next start -p 3195", cwd, url: "http://localhost:3195/login", reuseExistingServer: false, timeout: 120_000,
      env: { ...base("vlan"), PXE_VLAN_NETWORKS: "20:10.99.20.0/24:10.99.20.1;30:10.99.30.0/26:10.99.30.1" } },
  ],
})
