import { readdirSync } from "node:fs"
import path from "node:path"

import { defineConfig, devices } from "@playwright/test"

import { e2eDb, e2eLeaseFile, e2eMedia } from "./e2e/support/e2e-env"

const PORT = 3100
const BASE_URL = `http://localhost:${PORT}`
/** Server E2E kedua (polling + discovery lewat /boot) untuk AC-2.9 / AC-4.12. */
const DISCOVERY_PORT = 3101

/**
 * Subnet management lab, diset eksplisit lewat env `PXE_MGMT_*` (DEC-006) — nilai sama dengan
 * default `MGMT_NETWORK`, tetapi server E2E tidak bergantung pada default kode.
 */
const LAB_ENV = {
  PXE_MGMT_CIDR: "10.10.10.0/24",
  PXE_MGMT_GATEWAY: "10.10.10.1",
  PXE_MGMT_DNS: "10.10.10.1",
  PXE_SERVER_IP: "10.10.10.1",
  PXE_DYNAMIC_RANGE: "10.10.10.100-10.10.10.200",
}

/** Subnet KVM (DEC-003/006) untuk membuktikan form mengikuti `GET /api/network` (CR-3-2). */
const KVM_ENV = {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.1",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DYNAMIC_RANGE: "10.99.0.100-10.99.0.200",
}

/**
 * M4 (DEC-007): setiap server memakai file DB SQLite sendiri yang di-seed sebelum start
 * (e2e/support/e2e-env.ts). `PXE_SEED=empty` di server: DB demo sudah berisi flag `meta.seeded`.
 */
const dbEnv = (name: string, seed: "demo" | "empty" = "demo") => ({
  PXE_DB_PATH: e2eDb({ name, seed }),
  PXE_SEED: "empty",
})

/**
 * Server M4 (discovery + install + callback disimulasikan via `request`): subnet KVM, DNS
 * 10.99.0.2, `PXE_TRUST_PROXY=1` (test mengirim `X-Real-IP` seperti nginx), media palsu
 * (Ubuntu 22.04 sengaja tidak ada), lease fixture. Host `localhost` tetap di allowlist default.
 */
const M4_ENV = {
  ...KVM_ENV,
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_DHCP_INTERFACE: "pxe0",
  PXE_TRUST_PROXY: "1",
  PXE_MEDIA_ROOT: e2eMedia(),
}

/**
 * CR-2-9: setiap file spec yang memutasi data mendapat server `next start` sendiri (DB sementara
 * segar dari seed) sehingga hasil tidak bergantung urutan file, `--grep`, atau eksekusi
 * parsial. Semua server memakai build produksi yang sama (dibuat oleh server pertama).
 */
const FILE_SERVERS = [
  { name: "m2-hosts-table", port: 3102, testMatch: /m2-hosts-table\.spec\.ts/, env: { ...LAB_ENV, ...dbEnv("m2-hosts-table") } },
  { name: "m3-sheet", port: 3103, testMatch: /m3-sheet\.spec\.ts/, env: { ...LAB_ENV, ...dbEnv("m3-sheet"), PXE_MEDIA_ROOT: e2eMedia() } },
  { name: "m3-bulk", port: 3104, testMatch: /m3-bulk\.spec\.ts/, env: { ...LAB_ENV, ...dbEnv("m3-bulk"), PXE_MEDIA_ROOT: e2eMedia() } },
  { name: "iter2-ui", port: 3105, testMatch: /iter2-ui\.spec\.ts/, env: { ...LAB_ENV, ...dbEnv("iter2-ui") } },
  { name: "iter2-network-env", port: 3106, testMatch: /iter2-network-env\.spec\.ts/, env: { ...KVM_ENV, ...dbEnv("iter2-network-env") } },
  { name: "iter3-ui", port: 3107, testMatch: /iter3-ui\.spec\.ts/, env: { ...LAB_ENV, ...dbEnv("iter3-ui") } },
  {
    name: "m4-discovery",
    port: 3108,
    testMatch: /m4-discovery\.spec\.ts/,
    env: { ...M4_ENV, ...dbEnv("m4-discovery", "empty"), PXE_DNSMASQ_LEASES: e2eLeaseFile("m4-discovery") },
  },
  { name: "m4-settings", port: 3109, testMatch: /m4-settings\.spec\.ts/, env: { ...M4_ENV, ...dbEnv("m4-settings") } },
] as const

const chromium = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }

const TEST_DIR = path.join(__dirname, "e2e")
/** Pola `testMatch` project "chromium" (spec read-only di server :3100). */
const SHARED_MATCH = [/m1-.*\.spec\.ts/, /smoke\.spec\.ts/]
const POLLING_MATCH = /m2-polling\.spec\.ts/

/**
 * CR-1-9: setiap file spec di `e2e/` (termasuk subfolder) wajib terkumpul oleh tepat satu
 * project. File yatim (tidak cocok pola mana pun) atau ganda membuat config gagal dimuat, sehingga
 * suite tidak menyempit diam-diam.
 * CR-1-10: pencarian rekursif — spec di subfolder juga diperiksa (Playwright mengumpulkan subfolder).
 */
function assertEverySpecCollected() {
  const patterns = [...SHARED_MATCH, POLLING_MATCH, ...FILE_SERVERS.map((s) => s.testMatch)]
  const specs = readdirSync(TEST_DIR, { recursive: true, encoding: "utf8" }).filter((f) => /\.spec\.[cm]?[jt]sx?$/.test(f))
  const problems = specs
    .map((f) => ({ f, n: patterns.filter((re) => re.test(path.join(TEST_DIR, f))).length }))
    .filter(({ n }) => n !== 1)
    .map(({ f, n }) => `${f} (cocok ${n} project)`)
  if (problems.length) {
    throw new Error(
      `playwright.config.ts: spec E2E tidak terkumpul tepat satu project: ${problems.join(", ")}. ` +
        "Tambahkan ke FILE_SERVERS atau pola project yang sesuai.",
    )
  }
}
assertEverySpecCollected()

// E2E selalu terhadap build produksi (`next build && next start`) dengan DB SQLite sementara per
// server (DEC-005/DEC-007) agar keadaan deterministik. Chromium bundel Playwright (DEC-004).
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  globalTeardown: "./e2e/support/teardown.ts",
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    locale: "id-ID",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      // Spec read-only (M1 + smoke) berbagi server :3100.
      name: "chromium",
      testMatch: SHARED_MATCH,
      use: { ...chromium, baseURL: BASE_URL },
    },
    {
      name: "m2-polling",
      testMatch: POLLING_MATCH,
      use: { ...chromium, baseURL: `http://localhost:${DISCOVERY_PORT}` },
    },
    ...FILE_SERVERS.map((s) => ({
      name: s.name,
      testMatch: s.testMatch,
      use: { ...chromium, baseURL: `http://localhost:${s.port}` },
    })),
  ],
  webServer: [
    {
      command: `npm run build && npm run start -- -p ${PORT}`,
      url: `${BASE_URL}/hosts`,
      env: { ...LAB_ENV, ...dbEnv("shared") },
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // AC-2.9/AC-4.12: server kedua dari build yang sama. Simulasi discovery mock sudah dihapus
      // (M4); host baru muncul lewat request `/boot/{mac}.ipxe` dari test (discovery nyata).
      command: `npm run start -- -p ${DISCOVERY_PORT}`,
      url: `http://localhost:${DISCOVERY_PORT}/design`,
      env: { ...LAB_ENV, ...dbEnv("m2-polling") },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    ...FILE_SERVERS.map((s) => ({
      command: `npm run start -- -p ${s.port}`,
      url: `http://localhost:${s.port}/design`,
      env: s.env,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    })),
  ],
})
