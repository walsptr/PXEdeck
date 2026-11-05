// Suite KVM M4 (M4-T13). HANYA dijalankan oleh infra/kvm-run.sh <m> (yang membuat network, VM
// pxe-test-server, deploy dashboard, node pxe-test-<m>-nodeNN, lalu cleanup via trap). Tidak ada
// webServer: base URL = dashboard di VM server (http://10.99.0.2, lewat nginx).
//
// Bukti (PXE_KVM_RUNS_DIR): playwright-kvm.json, results.json, screenshot, log status. Trace & video
// dimatikan: password acak per run diketik ke form dan TIDAK boleh tersimpan di artefak apa pun.
import path from "node:path"

import { defineConfig, devices } from "@playwright/test"

const runsDir = process.env.PXE_KVM_RUNS_DIR
if (!runsDir || !process.env.PXE_KVM_BASE_URL) {
  throw new Error("e2e-kvm: jalankan lewat infra/kvm-run.sh (PXE_KVM_BASE_URL/PXE_KVM_RUNS_DIR kosong)")
}

const spec = process.env.PXE_KVM_SPEC ?? "m4"
if (!/^m[0-9]+$/.test(spec)) throw new Error(`e2e-kvm: PXE_KVM_SPEC '${spec}' harus m<angka>`)

export default defineConfig({
  testDir: __dirname,
  // Spec per milestone: kvm-run.sh <m> menyetel PXE_KVM_SPEC=<m> (default m4) → `<m>-*.spec.ts`.
  testMatch: new RegExp(`(^|/)${spec}-[^/]*\\.spec\\.ts$`),
  outputDir: path.join(runsDir, "playwright-kvm-artifacts"),
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  // Per node: install ≤ 30 menit (CLAUDE.md) + konfigurasi/verifikasi/reboot.
  timeout: 50 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["json", { outputFile: path.join(runsDir, "playwright-kvm.json") }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.PXE_KVM_BASE_URL,
    viewport: { width: 1440, height: 900 },
    locale: "id-ID",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
})
