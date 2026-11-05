// M5-T13 E2E — webserver Playwright kedua dengan timeout pendek (DEC-014 §6, O13/O14; tanpa seam
// test di kode produk): server "m5-timeout" = build produksi yang sama dengan env
// PXE_JOB_BOOTING_TIMEOUT_MIN=1, PXE_WATCHDOG_INTERVAL_SEC=5.
//  - AC-5.26 install tanpa callback → ≤ 90 dtk pill Failed di tabel Hosts DAN halaman Jobs tanpa
//            reload, alasan "Timeout di tahap Booting"; Install OS ulang → Booting.
import { expect, test } from "@playwright/test"

import { rowByMac, SHOTS } from "./helpers"
import { apiInstall, expectNoReload, HEX, hostId, jobsOf, leaseWriter, makeHost, markNoReload } from "./m5-support"
import { e2eLeaseFile } from "./support/e2e-env"

const lease = leaseWriter(e2eLeaseFile("m5-timeout"))
const H = { mac: "52:54:00:99:00:51", leaseIp: "10.99.0.151", staticIp: "10.99.0.51", hostname: "m5-timeout-51" }

test("AC-5.26 timeout Booting (1 mnt) → Failed ≤ 90 dtk di Hosts & Jobs tanpa reload; Install ulang → Booting", async ({ page, context }) => {
  test.setTimeout(4 * 60_000)
  const s = await (await page.request.get("/api/settings")).json()
  expect(s.jobTimeouts.bootingMin).toBe(1) // server kedua memang ber-timeout pendek
  const id = await makeHost(page.request, lease, { ...H, newKey: true })

  await page.goto("/hosts")
  await markNoReload(page)
  const row = rowByMac(page, H.mac)
  const pill = row.locator("[data-status]")
  await expect(pill).toHaveAttribute("data-status", "discovered")

  const t0 = Date.now()
  await apiInstall(page.request, id)
  await expect(pill).toHaveAttribute("data-status", "booting", { timeout: 10_000 })
  const [job] = await jobsOf(page.request, id)

  const jobs = await context.newPage()
  await jobs.goto(`/jobs?host=${id}`)
  await markNoReload(jobs)
  await expect(jobs.getByTestId("job-detail")).toHaveAttribute("data-job-id", job.id)
  await expect(jobs.getByTestId("job-detail").locator("[data-status]").first()).toHaveAttribute("data-status", "booting")

  // Tanpa callback apa pun: watchdog (timer 5 dtk / sapuan lazy) menandai Failed.
  await expect(pill).toHaveAttribute("data-status", "failed", { timeout: 90_000 })
  const tHosts = Date.now() - t0
  expect(tHosts).toBeLessThanOrEqual(90_000)
  expect(tHosts).toBeGreaterThanOrEqual(60_000) // tidak sebelum timeout 1 mnt
  await expect(pill).toHaveCSS("background-color", HEX.failed)
  await expect(row.getByTestId("host-failure-reason")).toContainText("Timeout di tahap Booting")
  await expectNoReload(page)
  await page.screenshot({ path: SHOTS(5, "ac-5.26-hosts-failed") })

  const detail = jobs.getByTestId("job-detail")
  await expect(detail.locator("[data-status]").first()).toHaveAttribute("data-status", "failed", { timeout: 90_000 - (Date.now() - t0) + 5_000 })
  expect(Date.now() - t0).toBeLessThanOrEqual(95_000)
  await expect(detail.getByTestId("job-failure-reason")).toHaveAttribute("data-reason", "timeout-booting")
  await expect(detail.getByTestId("job-failure-reason")).toContainText("Timeout di tahap Booting (> 1 mnt)")
  await expect(jobs.locator(`[data-testid="job-row"][data-job-id="${job.id}"] [data-testid="job-row-failure"]`)).toContainText("Timeout di tahap Booting")
  await expect(detail.locator('[data-testid="timeline-step"][data-stage="failed"]')).toHaveAttribute("data-reached", "true")
  await expectNoReload(jobs)
  await jobs.screenshot({ path: SHOTS(5, "ac-5.26-jobs-failed") })
  expect((await jobsOf(page.request, id))[0]).toMatchObject({ id: job.id, status: "failed", failureReason: "timeout-booting" })

  // Install OS ulang dari UI → Booting (job baru).
  await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: "Install OS" }).click()
  const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  await expect(sheet.getByTestId("sheet-last-job-failure")).toContainText("Timeout di tahap Booting")
  await sheet.getByRole("button", { name: /^(Simpan & Install|Install)$/ }).click()
  const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(H.mac)}/install`))
  await page.getByRole("alertdialog", { name: /^Install OS ke / }).getByRole("button", { name: "Hapus disk & install" }).click()
  expect((await installed).status()).toBe(200)
  await expect(pill).toHaveAttribute("data-status", "booting")
  const after = await jobsOf(page.request, id)
  expect(after.map((j) => [j.status, j.failureReason])).toEqual([["booting", null], ["failed", "timeout-booting"]])
  await page.screenshot({ path: SHOTS(5, "ac-5.26-reinstall-booting") })
})
