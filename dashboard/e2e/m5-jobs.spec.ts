// M5-T13 E2E (server "m5-jobs": subnet KVM, DB kosong, PXE_TRUST_PROXY=1 + lease fixture, media
// palsu). Request firmware/installer disimulasikan dengan `request` + `X-Real-IP`.
//  - AC-5.1  halaman Settings menampilkan pengaturan job read-only (mono)
//  - AC-5.22 halaman Jobs: empty state, daftar (host mono, OS, pill, dibuat relatif, durasi),
//            status berubah tanpa reload ≤ 10 dtk, filter status & host
//  - AC-5.23 timeline 4 pill warna persis + Done teks putih + waktu mono; Failed #cf2d56 + alasan;
//            audit pastel / box-shadow / oranye
//  - AC-5.24 log streaming SSE: baris ≤ 3 dtk tanpa reload, JetBrains Mono, autoscroll, redaksi,
//            putus (page.route) → "Terputus" → tersambung ulang tanpa baris ganda, "Selesai"
//  - AC-5.25 Hosts: "Lihat log" → /jobs?host=<id>, job terbaru terpilih + judul riwayat; Failed +
//            alasan di tabel; Install OS dari host Failed → riwayat 2 job
//  - AC-5.32 /jobs judul 26 px + konten nyata (bukan placeholder)
import { expect, test, type Page } from "@playwright/test"

import { dropShadowViolations, orangeElements, rowByMac, SHOTS } from "./helpers"
import {
  apiInstall,
  expectNoReload,
  HEX,
  hostId,
  installer,
  jobsOf,
  leaseWriter,
  makeHost,
  markNoReload,
  pastelOutsidePills,
} from "./m5-support"
import { e2eLeaseFile } from "./support/e2e-env"

test.describe.configure({ mode: "serial" })

const lease = leaseWriter(e2eLeaseFile("m5-jobs"))
const H1 = { mac: "52:54:00:99:00:41", leaseIp: "10.99.0.141", staticIp: "10.99.0.41", hostname: "m5-e2e-41" }
const H2 = { mac: "52:54:00:99:00:42", leaseIp: "10.99.0.142", staticIp: "10.99.0.42", hostname: "m5-e2e-42" }
const H3 = { mac: "52:54:00:99:00:43", leaseIp: "10.99.0.143", staticIp: "10.99.0.43", hostname: "m5-e2e-43" }
const H4 = { mac: "52:54:00:99:00:44", leaseIp: "10.99.0.144", staticIp: "10.99.0.44" } // tanpa hostname → MAC

const jobRow = (page: Page, jobId: string) => page.locator(`[data-testid="job-row"][data-job-id="${jobId}"]`)

test("AC-5.22/5.32 Jobs: empty state sebelum ada job, judul 26 px, tanpa placeholder", async ({ page }) => {
  await page.goto("/jobs")
  await expect(page.getByTestId("jobs-page")).toBeVisible()
  const h1 = page.locator("header h1")
  await expect(h1).toHaveText("Provisioning Jobs")
  await expect(h1).toHaveCSS("font-size", "26px")
  await expect(h1).toHaveCSS("font-weight", "400")
  const empty = page.getByTestId("jobs-empty")
  await expect(empty).toBeVisible()
  await expect(empty).toContainText("Belum ada job")
  await expect(empty).toContainText("Job dibuat saat Install OS dijalankan dari halaman Hosts")
  await expect(page.locator("main")).not.toContainText("dibangun di tahap")
  await page.screenshot({ path: SHOTS(5, "ac-5.22-empty") })
})

test("AC-5.1 Settings menampilkan pengaturan job read-only (mono)", async ({ page }) => {
  await page.goto("/settings")
  const sec = page.locator('[data-slot="settings-section"]').filter({ hasText: "Job & watchdog" })
  await expect(sec).toBeVisible()
  for (const [label, value] of [
    ["Timeout Booting", "60 menit"],
    ["Timeout Installing", "120 menit"],
    ["Timeout Configuring", "60 menit"],
    ["Batas penyajian installer", "3 kali per job"],
  ]) {
    const row = sec.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) })
    const v = row.locator("dd span").first()
    await expect(v).toHaveText(value)
    expect(await v.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  }
  await expect(sec.locator("dl > div").filter({ hasText: "Pemeriksaan lease DHCP" })).toContainText("Aktif")
  await expect(page.getByTestId("insecure-lease-warning")).toHaveCount(0)
  await expect(page.locator("main input, main textarea, main select, main [role=switch]")).toHaveCount(0)
  await page.screenshot({ path: SHOTS(5, "ac-5.1-settings") })
})

test("AC-5.22/5.23 daftar + status live tanpa reload, filter, timeline warna persis, audit", async ({ page }) => {
  await makeHost(page.request, lease, { ...H1, newKey: true })
  await makeHost(page.request, lease, { ...H2, newKey: true })
  await page.goto("/jobs")
  await expect(page.getByTestId("jobs-empty")).toBeVisible()
  await markNoReload(page)

  await apiInstall(page.request, hostId(H1.mac))
  const [j1] = await jobsOf(page.request, hostId(H1.mac))
  const row1 = jobRow(page, j1.id)
  await expect(row1).toBeVisible({ timeout: 10_000 })
  const t0 = Date.now()
  // Host mono (hostname) + MAC mono, OS, pill, dibuat relatif, durasi mono.
  const hostCell = row1.locator("td").first()
  await expect(hostCell).toContainText(H1.hostname)
  await expect(hostCell).toContainText(H1.mac)
  expect(await hostCell.getByText(H1.hostname, { exact: true }).evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  expect(await hostCell.getByText(H1.mac, { exact: true }).evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  await expect(row1.getByTestId("job-row-os")).toContainText("Ubuntu Server 24.04")
  await expect(row1.locator("[data-status]")).toHaveAttribute("data-status", "booting")
  await expect(row1.getByTestId("job-row-created")).toHaveText(/baru saja|detik|dtk|menit|mnt/)
  await expect(row1.getByTestId("job-row-duration")).toHaveText(/\d+ (dtk|mnt)/)
  expect(await row1.getByTestId("job-row-duration").evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)

  // Status berubah tanpa reload ≤ 10 dtk.
  const sim = installer(page.request, H1.mac, H1.leaseIp, H1.staticIp)
  await sim.boot()
  await sim.file("meta-data")
  await sim.file("user-data")
  await expect(row1.locator("[data-status]")).toHaveAttribute("data-status", "installing", { timeout: 10_000 })
  expect(await sim.status("configuring", H1.leaseIp)).toBe(200)
  await expect(row1.locator("[data-status]")).toHaveAttribute("data-status", "configuring", { timeout: 10_000 })
  expect(await sim.status("done")).toBe(200)
  await expect(row1.locator("[data-status]")).toHaveAttribute("data-status", "done", { timeout: 10_000 })
  expect(Date.now() - t0).toBeLessThan(40_000)
  await expectNoReload(page)

  // H2 gagal (callback failed dari installer).
  await apiInstall(page.request, hostId(H2.mac))
  const sim2 = installer(page.request, H2.mac, H2.leaseIp, H2.staticIp)
  await sim2.boot()
  await sim2.file("user-data")
  expect(await sim2.status("failed", H2.leaseIp)).toBe(200)
  const [j2] = await jobsOf(page.request, hostId(H2.mac))
  await expect(jobRow(page, j2.id).locator("[data-status]")).toHaveAttribute("data-status", "failed", { timeout: 10_000 })
  await expect(jobRow(page, j2.id).getByTestId("job-row-failure")).toContainText("Installer melaporkan gagal")
  await page.screenshot({ path: SHOTS(5, "ac-5.22-jobs-list") })

  // ---- Filter status ----
  await page.getByTestId("jobs-status-filter").click()
  await page.getByRole("option", { name: "Failed" }).click()
  await expect(page).toHaveURL(/status=failed/)
  await expect(page.getByTestId("job-row")).toHaveCount(1)
  await expect(jobRow(page, j2.id)).toBeVisible()
  await page.getByTestId("jobs-status-filter").click()
  await page.getByRole("option", { name: "Semua status" }).click()
  await expect(page.getByTestId("job-row")).toHaveCount(2)
  // ---- Filter host (combobox mono) ----
  await page.getByTestId("jobs-host-filter").click()
  await page.getByPlaceholder("Cari hostname atau MAC…").fill(H1.hostname)
  await page.getByRole("option", { name: new RegExp(H1.hostname) }).click()
  await expect(page).toHaveURL(new RegExp(`host=${hostId(H1.mac)}`))
  await expect(page.getByTestId("job-row")).toHaveCount(1)
  await expect(jobRow(page, j1.id)).toBeVisible()
  expect(await page.getByTestId("jobs-host-filter").locator("span").first().evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  await page.screenshot({ path: SHOTS(5, "ac-5.22-filter-host") })

  // ---- AC-5.23 timeline job done ----
  await jobRow(page, j1.id).click()
  const detail = page.getByTestId("job-detail")
  await expect(detail).toHaveAttribute("data-job-id", j1.id)
  const steps = detail.getByTestId("timeline-step")
  await expect(steps).toHaveCount(4)
  expect(await steps.evaluateAll((els) => els.map((e) => e.getAttribute("data-stage")))).toEqual(["booting", "installing", "configuring", "done"])
  for (const [i, st] of (["booting", "installing", "configuring", "done"] as const).entries()) {
    const pill = steps.nth(i).locator(`[data-status="${st}"]`)
    await expect(pill).toHaveCSS("background-color", HEX[st])
    await expect(steps.nth(i)).toHaveAttribute("data-reached", "true")
    const time = steps.nth(i).getByTestId("timeline-time")
    await expect(time).toHaveText(/^\d{2}[.:]\d{2}[.:]\d{2}$/)
    expect(await time.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  }
  await expect(steps.nth(3).locator('[data-status="done"]')).toHaveCSS("color", "rgb(255, 255, 255)")
  await page.screenshot({ path: SHOTS(5, "ac-5.23-timeline-done") })

  // Audit: pastel hanya di [data-status], box-shadow 0, oranye hanya CTA primary (Jobs tanpa CTA).
  expect(await pastelOutsidePills(page)).toEqual([])
  expect(await dropShadowViolations(page)).toEqual([])
  const orange = await orangeElements(page)
  expect(orange.filter((o) => !(o.tag === "button" && o.variant === "default"))).toEqual([])

  // ---- timeline job failed ----
  await page.goto(`/jobs?job=${j2.id}`)
  const d2 = page.getByTestId("job-detail")
  await expect(d2).toHaveAttribute("data-job-id", j2.id)
  const fStep = d2.locator('[data-testid="timeline-step"][data-stage="failed"]')
  await expect(fStep).toHaveAttribute("data-reached", "true")
  await expect(fStep.locator('[data-status="failed"]')).toHaveCSS("background-color", HEX.failed)
  await expect(d2.locator('[data-testid="timeline-step"][data-stage="configuring"]')).toHaveAttribute("data-reached", "false")
  await expect(d2.locator('[data-testid="timeline-step"][data-stage="configuring"] [data-status]')).toHaveCount(0)
  const reason = d2.getByTestId("job-failure-reason")
  await expect(reason).toHaveAttribute("data-reason", "installer-error")
  await expect(reason).toContainText("Installer melaporkan gagal")
  expect(await pastelOutsidePills(page)).toEqual([])
  await page.screenshot({ path: SHOTS(5, "ac-5.23-timeline-failed") })
})

test("AC-5.24 log streaming SSE: live ≤ 3 dtk, mono, autoscroll, redaksi, putus → sambung ulang tanpa ganda, Selesai", async ({ page }) => {
  await makeHost(page.request, lease, { ...H3, newKey: true })
  await apiInstall(page.request, hostId(H3.mac))
  const sim = installer(page.request, H3.mac, H3.leaseIp, H3.staticIp)
  await sim.boot()
  await sim.file("user-data")
  const [job] = await jobsOf(page.request, hostId(H3.mac))

  // Koneksi SSE pertama: dilayani sebagian (backlog 2 event pertama) lalu ditutup → putus.
  const evs = (await (await page.request.get(`/api/jobs/${job.id}/logs?format=json`)).json()).events as { seq: number }[]
  expect(evs.length).toBeGreaterThanOrEqual(3)
  let sseRequests = 0
  const afterParams: (string | null)[] = []
  await page.route(`**/api/jobs/${job.id}/logs**`, async (route) => {
    const req = route.request()
    if (!(req.headers()["accept"] ?? "").includes("text/event-stream")) return route.continue()
    sseRequests++
    afterParams.push(new URL(req.url()).searchParams.get("after"))
    if (sseRequests === 1) {
      const body = "retry: 3000\n\n" + evs.slice(0, 2).map((e) => `event: log\nid: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`).join("")
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body })
    }
    return route.continue()
  })
  await page.goto(`/jobs?host=${hostId(H3.mac)}`)
  await markNoReload(page)
  const conn = page.getByTestId("log-connection")
  await expect(page.getByTestId("job-detail")).toHaveAttribute("data-job-id", job.id)
  await expect(conn).toHaveAttribute("data-state", "reconnecting", { timeout: 10_000 })
  await expect(conn).toContainText("Terputus")
  await page.screenshot({ path: SHOTS(5, "ac-5.24-reconnecting") })
  await expect(conn).toHaveAttribute("data-state", "live", { timeout: 15_000 })
  expect(sseRequests).toBeGreaterThanOrEqual(2)
  expect(afterParams[1]).toBe(String(evs[1].seq)) // resume dari seq terakhir yang diterima
  const lines = page.getByTestId("log-line")
  await expect(lines).toHaveCount(evs.length)

  // Baris baru via POST /log → tampil ≤ 3 dtk tanpa reload.
  const t0 = Date.now()
  expect(await sim.log("installer: penanda live E2E\n")).toBe(200)
  await expect(lines.filter({ hasText: "installer: penanda live E2E" })).toHaveCount(1, { timeout: 3_000 })
  expect(Date.now() - t0).toBeLessThanOrEqual(3_000)
  const last = lines.last()
  expect(await last.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/^"?JetBrains Mono/)
  await expect(last).toHaveCSS("font-size", "13px")

  // Redaksi: hash + token fixture tampil tersamarkan.
  const FAKE_TOKEN = "E2Efixture-token-not-real_000000000000000000".slice(0, 43)
  const HASH = `$6$rounds=5000$e2esalt$${"k".repeat(86)}`
  expect(await sim.log(`curl /boot/${H3.mac}/${FAKE_TOKEN}/status\npassword ${HASH}\n`)).toBe(200)
  await expect(lines.filter({ hasText: `/boot/${H3.mac}/[REDACTED]/status` })).toHaveCount(1, { timeout: 3_000 })
  await expect(lines.filter({ hasText: "password $6$[REDACTED]" })).toHaveCount(1)
  await expect(page.getByTestId("job-log")).not.toContainText(FAKE_TOKEN)
  await expect(page.getByTestId("job-log")).not.toContainText("e2esalt")

  // Autoscroll: banyak baris → log tetap di bawah saat "Ikuti log" aktif.
  await expect(page.getByTestId("log-follow")).toHaveAttribute("aria-checked", "true")
  expect(await sim.log(Array.from({ length: 60 }, (_, i) => `installer: baris ${i}`).join("\n") + "\n")).toBe(200)
  await expect(lines.filter({ hasText: "installer: baris 59" })).toHaveCount(1, { timeout: 3_000 })
  const box = page.getByTestId("log-lines")
  await expect
    .poll(() => box.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop))
    .toBeLessThanOrEqual(2)
  expect(await box.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true)
  // Tanpa baris ganda: data-seq unik dan jumlah = event job.
  const seqs = await lines.evaluateAll((els) => els.map((e) => e.getAttribute("data-seq")))
  expect(new Set(seqs).size).toBe(seqs.length)
  const evCount = (await jobsOf(page.request, hostId(H3.mac)))[0].eventCount
  expect(seqs.length).toBe(evCount)
  await page.screenshot({ path: SHOTS(5, "ac-5.24-log-live") })

  // Job selesai → indikator "Selesai".
  expect(await sim.status("configuring", H3.leaseIp)).toBe(200)
  expect(await sim.status("done")).toBe(200)
  await expect(conn).toHaveAttribute("data-state", "ended", { timeout: 10_000 })
  await expect(conn).toContainText("Selesai")
  await expect(page.getByTestId("job-detail").locator("[data-status]").first()).toHaveAttribute("data-status", "done", { timeout: 10_000 })
  const seqs2 = await lines.evaluateAll((els) => els.map((e) => e.getAttribute("data-seq")))
  expect(new Set(seqs2).size).toBe(seqs2.length)
  await expectNoReload(page)
  await page.screenshot({ path: SHOTS(5, "ac-5.24-log-ended") })
})

test("AC-5.25 Hosts: Lihat log → riwayat host + job terbaru terpilih; Failed + alasan; Install ulang → 2 job", async ({ page }) => {
  await makeHost(page.request, lease, { ...H4, newKey: true })
  const id = hostId(H4.mac)
  await apiInstall(page.request, id)
  const sim = installer(page.request, H4.mac, H4.leaseIp, H4.staticIp)
  await sim.boot()
  await sim.file("user-data")
  expect(await sim.status("failed", H4.leaseIp)).toBe(200)

  await page.goto("/hosts")
  await markNoReload(page)
  const row = rowByMac(page, H4.mac)
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "failed")
  await expect(row.locator("[data-status]")).toHaveCSS("background-color", HEX.failed)
  await expect(row.getByTestId("host-failure-reason")).toContainText("Installer melaporkan gagal")
  await page.screenshot({ path: SHOTS(5, "ac-5.25-host-failed") })

  await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: "Lihat log" }).click()
  await expect(page).toHaveURL(new RegExp(`/jobs\\?host=${id}`))
  const [jOld] = await jobsOf(page.request, id)
  await expect(page.getByTestId("jobs-history-header")).toContainText(`Riwayat ${H4.mac}`)
  await expect(page.getByTestId("jobs-history-count")).toHaveText("1 job")
  await expect(jobRow(page, jOld.id)).toHaveAttribute("data-state", "selected")
  await expect(page.getByTestId("job-detail")).toHaveAttribute("data-job-id", jOld.id)
  // DR-5-7: baris terpilih = canvas-soft + indikator kiri ink; semua teks (di luar pill status)
  // kontras ≥ 4,5:1 terhadap latar baris. I-5-8: OS yang bisa terpotong punya `title`.
  const sel = jobRow(page, jOld.id)
  await expect(sel).toHaveCSS("background-color", "rgb(250, 250, 247)")
  const firstCell = sel.locator("td").first()
  await expect(firstCell).toHaveCSS("border-left-color", "rgb(38, 37, 30)")
  await expect(firstCell).toHaveCSS("border-left-width", "2px")
  await expect(sel.getByTestId("job-row-failure")).toBeVisible()
  const lowContrast = await sel.evaluate((row) => {
    const lum = (c: string) => {
      const [r, g, b] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number).map((v) => {
        const x = v / 255
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const bg = getComputedStyle(row).backgroundColor
    const out: string[] = []
    for (const el of row.querySelectorAll<HTMLElement>("*")) {
      if (el.closest("[data-status]")) continue
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())
      if (!ownText || !el.getClientRects().length) continue
      const [a, b] = [lum(getComputedStyle(el).color), lum(bg)].sort((x, y) => y - x)
      const ratio = (a + 0.05) / (b + 0.05)
      if (ratio < 4.5) out.push(`${el.textContent!.trim().slice(0, 30)}: ${ratio.toFixed(2)}`)
    }
    return out
  })
  expect(lowContrast).toEqual([])
  const os = sel.getByTestId("job-row-os")
  await expect(os).toHaveAttribute("title", (await os.innerText()).trim())
  await page.screenshot({ path: SHOTS(5, "dr-5-7-job-selected") })

  // Install OS ulang dari host Failed (UI).
  await page.goto("/hosts")
  await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: "Install OS" }).click()
  const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  await expect(sheet.getByTestId("sheet-last-job-failure")).toContainText("Installer melaporkan gagal")
  await sheet.getByRole("button", { name: /^(Simpan & Install|Install)$/ }).click()
  const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${id}/install`))
  await page.getByRole("alertdialog", { name: /^Install OS ke / }).getByRole("button", { name: "Hapus disk & install" }).click()
  expect((await installed).status()).toBe(200)
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "booting")

  await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: "Lihat log" }).click()
  const jobs = await jobsOf(page.request, id)
  expect(jobs.map((j) => j.status)).toEqual(["booting", "failed"])
  await expect(page.getByTestId("jobs-history-count")).toHaveText("2 job")
  await expect(page.getByTestId("job-row")).toHaveCount(2)
  await expect(jobRow(page, jobs[0].id)).toHaveAttribute("data-state", "selected")
  await expect(page.getByTestId("job-detail")).toHaveAttribute("data-job-id", jobs[0].id)
  await page.screenshot({ path: SHOTS(5, "ac-5.25-history-2-jobs") })
})
