import { defineConfig, devices } from "@playwright/test"

const PORT = 3100
const BASE_URL = `http://localhost:${PORT}`
/** Server E2E kedua (simulasi + discovery cepat) untuk AC-2.9. */
const DISCOVERY_PORT = 3101

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `npm run build && npm run start -- -p ${PORT}`,
      url: `${BASE_URL}/hosts`,
      env: { PXE_MOCK_SIMULATION: "off" },
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
      env: { PXE_MOCK_SIMULATION: "on", PXE_MOCK_DISCOVER_EVERY_MS: "2000" },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
})
