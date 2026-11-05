import { defineConfig, devices } from "@playwright/test"

const PORT = 3100
const BASE_URL = `http://localhost:${PORT}`
/** Server E2E kedua (simulasi + discovery cepat) untuk AC-2.9. */
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
 * CR-2-9: setiap file spec yang memutasi store mock mendapat server `next start` sendiri (store
 * in-memory segar dari seed) sehingga hasil tidak bergantung urutan file, `--grep`, atau eksekusi
 * parsial. Semua server memakai build produksi yang sama (dibuat oleh server pertama).
 */
const FILE_SERVERS = [
  { name: "m2-hosts-table", port: 3102, testMatch: /m2-hosts-table\.spec\.ts/, env: LAB_ENV },
  { name: "m3-sheet", port: 3103, testMatch: /m3-sheet\.spec\.ts/, env: LAB_ENV },
  { name: "m3-bulk", port: 3104, testMatch: /m3-bulk\.spec\.ts/, env: LAB_ENV },
  { name: "iter2-ui", port: 3105, testMatch: /iter2-ui\.spec\.ts/, env: LAB_ENV },
  { name: "iter2-network-env", port: 3106, testMatch: /iter2-network-env\.spec\.ts/, env: KVM_ENV },
] as const

const chromium = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }

// E2E selalu terhadap build produksi (`next build && next start`) dengan simulasi store mock
// dimatikan (DEC-005) agar keadaan deterministik. Chromium bundel Playwright (DEC-004).
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
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
      testMatch: [/m1-.*\.spec\.ts/, /smoke\.spec\.ts/],
      use: { ...chromium, baseURL: BASE_URL },
    },
    {
      name: "m2-polling",
      testMatch: /m2-polling\.spec\.ts/,
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
      env: { PXE_MOCK_SIMULATION: "off", ...LAB_ENV },
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // AC-2.9 (DEC-005/O4): server kedua dari build yang sama dengan simulasi aktif dan
      // interval discovery diperpendek. Hanya dipakai e2e/m2-polling.spec.ts. Readiness memakai
      // /design agar store mock belum dibuat sebelum test (jam discovery mulai saat request
      // /api/hosts pertama).
      command: `npm run start -- -p ${DISCOVERY_PORT}`,
      url: `http://localhost:${DISCOVERY_PORT}/design`,
      env: { PXE_MOCK_SIMULATION: "on", PXE_MOCK_DISCOVER_EVERY_MS: "2000", ...LAB_ENV },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    ...FILE_SERVERS.map((s) => ({
      command: `npm run start -- -p ${s.port}`,
      // Readiness lewat /design: store mock baru dibuat saat test pertama memanggil /api/hosts.
      url: `http://localhost:${s.port}/design`,
      env: { PXE_MOCK_SIMULATION: "off", ...s.env },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    })),
  ],
})
