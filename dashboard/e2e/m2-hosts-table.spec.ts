// M2 E2E /hosts (simulasi mock off): AC-2.8, 2.10, 2.11, 2.12, 2.13, 2.14.
// Urutan test penting: store server dibagi antar test (workers: 1); test yang mengubah data
// (hapus/reboot) memakai host yang tidak dipakai test lain.
import { expect, test, type Page } from "@playwright/test"

import { gotoHosts, hostRows, hostsTable, ORANGE, rowByMac, SHOTS } from "./helpers"

type ApiHost = {
  id: string
  mac: string
  hostname: string | null
  status: string
  currentIp: string | null
  mgmtIp: string | null
  osInstalled: string | null
  osAssigned: string | null
}

/** Tombol dropdown filter status di toolbar (bukan header kolom "Status" yang bisa di-sort). */
const statusFilter = (page: Page) => page.locator('button[aria-haspopup="menu"]', { hasText: "Status" })

async function apiHosts(page: Page): Promise<ApiHost[]> {
  const res = await page.request.get("/api/hosts")
  expect(res.status()).toBe(200)
  return (await res.json()).hosts
}

test.describe("AC-2.8 kolom & isi tabel", () => {
  test("header kolom, satu baris per host API, '—', font mono, pill data-status", async ({ page }) => {
    await gotoHosts(page)
    const hosts = await apiHosts(page)
    const headers = hostsTable(page).locator("thead th")
    await expect(headers).toHaveCount(9)
    await expect(headers.nth(0).getByRole("checkbox", { name: "Pilih semua host" })).toBeVisible()
    const texts = (await headers.allTextContents()).map((t) => t.trim())
    expect(texts.slice(1)).toEqual(["MAC Address", "Hostname", "IP", "Vendor", "OS", "Status", "Last seen", "Aksi"])

    await expect(hostRows(page)).toHaveCount(hosts.length)
    for (const h of hosts) {
      const row = rowByMac(page, h.mac)
      await expect(row).toHaveCount(1)
      await expect(row.locator("[data-status]")).toHaveAttribute("data-status", h.status)
      const cells = row.locator("td")
      await expect(cells.nth(0).getByRole("checkbox")).toBeVisible()
      await expect(cells.nth(8).getByRole("button", { name: /^Aksi untuk / })).toBeVisible()
      const hostnameCell = cells.nth(2)
      if (h.hostname) await expect(hostnameCell).toHaveText(h.hostname)
      else await expect(hostnameCell).toHaveText("—")
    }
    // Font mono pada MAC dan hostname.
    const row = rowByMac(page, "52:54:00:10:10:11")
    for (const i of [1, 2]) {
      const font = await row.locator("td").nth(i).locator(".type-data").first().evaluate((el) => getComputedStyle(el).fontFamily)
      expect(font.startsWith('"JetBrains Mono Variable"')).toBe(true)
    }
    // Kolom IP: lease + IP management keduanya tampil.
    await expect(rowByMac(page, "94:40:c9:6e:01:ab").locator("td").nth(3)).toContainText("mgmt 10.10.10.42")
    await expect(rowByMac(page, "52:54:00:10:10:11").locator("td").nth(3)).toContainText("10.10.10.11")
    await expect(rowByMac(page, "52:54:00:10:10:11").locator("td").nth(3)).toContainText("mgmt statis")
    await expect(rowByMac(page, "52:54:00:10:10:11").locator("td").nth(4)).toHaveText("QEMU/KVM")
    await expect(rowByMac(page, "52:54:00:10:10:11").locator("td").nth(5)).toContainText("Ubuntu Server 24.04.5 LTS")
    await page.screenshot({ path: SHOTS(2, "ac-2.8-hosts-table"), fullPage: true })
  })
})

test.describe("AC-2.10 pencarian & filter", () => {
  test("pencarian MAC/hostname/IP mempersempit baris", async ({ page }) => {
    await gotoHosts(page)
    const all = await hostRows(page).count()
    const search = page.getByLabel("Cari host")
    await search.fill("ctrl-0")
    await expect(hostRows(page)).toHaveCount(3)
    await search.fill("0c-c4-7a")
    await expect(hostRows(page)).toHaveCount(2)
    await search.fill("10.10.10.143")
    await expect(hostRows(page)).toHaveCount(1)
    await expect(hostRows(page).first()).toContainText("b0:83:fe:5c:19:e2")
    await search.fill("10.10.10.42") // IP management storage-02
    await expect(hostRows(page)).toHaveCount(1)
    await page.getByRole("button", { name: "Hapus pencarian" }).click()
    await expect(hostRows(page)).toHaveCount(all)
  })

  test("filter status (hitungan + hanya status itu), filter OS, Reset, tanpa hasil", async ({ page }) => {
    await gotoHosts(page)
    const hosts = await apiHosts(page)
    const count = (s: string) => hosts.filter((h) => h.status === s).length

    await statusFilter(page).click()
    const menu = page.getByRole("menu")
    for (const [label, s] of [["Discovered", "discovered"], ["Done", "done"], ["Failed", "failed"], ["Offline", "offline"]]) {
      await expect(menu.getByRole("menuitemcheckbox", { name: new RegExp(`^${label}`) })).toContainText(String(count(s)))
    }
    await page.screenshot({ path: SHOTS(2, "ac-2.10-status-filter") })
    await menu.getByRole("menuitemcheckbox", { name: /^Done/ }).click()
    await page.keyboard.press("Escape")
    await expect(hostRows(page)).toHaveCount(count("done"))
    for (const st of await hostRows(page).locator("[data-status]").evaluateAll((els) => els.map((e) => e.getAttribute("data-status"))))
      expect(st).toBe("done")

    // Multi status (buka menu dengan keyboard; fokus kembali ke trigger setelah Escape).
    await expect(statusFilter(page)).toBeFocused()
    await page.keyboard.press("Enter")
    await page.getByRole("menu").getByRole("menuitemcheckbox", { name: /^Failed/ }).click()
    await page.keyboard.press("Escape")
    await expect(hostRows(page)).toHaveCount(count("done") + count("failed"))

    await page.getByRole("button", { name: "Reset", exact: true }).click()
    await expect(hostRows(page)).toHaveCount(hosts.length)

    await page.getByRole("combobox", { name: "Filter OS" }).click()
    await page.getByRole("option", { name: "Rocky Linux 9.4" }).click()
    await expect(hostRows(page)).toHaveCount(2)
    await expect(hostRows(page).nth(0)).toContainText("Rocky Linux 9.4")
    await page.getByRole("combobox", { name: "Filter OS" }).click()
    await page.getByRole("option", { name: "Belum ada OS" }).click()
    const noOs = hosts.filter((h) => !h.osInstalled && !h.osAssigned)
    expect(noOs.length).toBeGreaterThan(0)
    await expect(hostRows(page)).toHaveCount(noOs.length)
    for (const h of noOs) await expect(rowByMac(page, h.mac)).toHaveCount(1)
    const rocky = hosts.filter((h) => h.osInstalled === "rocky-9.4" || h.osAssigned === "rocky-9.4")
    expect(rocky).toHaveLength(2)

    await page.getByLabel("Cari host").fill("node01")
    await expect(hostsTable(page)).toContainText("Tidak ada host yang cocok dengan filter.")
    await page.screenshot({ path: SHOTS(2, "ac-2.10-no-match") })
    await page.getByRole("button", { name: "Reset filter" }).click()
    await expect(hostRows(page)).toHaveCount(hosts.length)
    await expect(page.getByLabel("Cari host")).toHaveValue("")
  })

  test("/hosts?q=<mac> mengisi pencarian awal", async ({ page }) => {
    await gotoHosts(page, "?q=0c-c4-7a-91-5e-11")
    await expect(page.getByLabel("Cari host")).toHaveValue("0c-c4-7a-91-5e-11")
    await expect(hostRows(page)).toHaveCount(1)
    await expect(hostRows(page).first()).toContainText("compute-02")
  })
})

test.describe("AC-2.11 seleksi & bulk bar", () => {
  test("2 baris → toolbar, tombol, hanya Install OS primary; batal mengosongkan", async ({ page }) => {
    await gotoHosts(page)
    await page.getByRole("checkbox", { name: "Pilih node01" }).click()
    await page.getByRole("checkbox", { name: "Pilih ctrl-01" }).click()
    const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
    await expect(bar).toBeVisible()
    await expect(bar).toContainText("2 host dipilih")
    const names = ["Set Credentials", "Set Hostname", "Set IP", "Inject SSH Key", "Install OS"]
    for (const n of names) await expect(bar.getByRole("button", { name: n })).toBeVisible()
    for (const n of names.slice(0, 4)) {
      const b = bar.getByRole("button", { name: n })
      await expect(b).toHaveAttribute("data-variant", "outline")
      await expect(b).not.toHaveCSS("background-color", ORANGE)
    }
    await expect(bar.getByRole("button", { name: "Install OS" })).toHaveAttribute("data-variant", "default")
    await expect(bar.getByRole("button", { name: "Install OS" })).toHaveCSS("background-color", ORANGE)
    await page.screenshot({ path: SHOTS(2, "ac-2.11-bulk-bar") })
    await bar.getByRole("button", { name: "Batalkan pilihan" }).click()
    await expect(bar).toBeHidden()
    await expect(page.getByRole("checkbox", { name: "Pilih node01" })).toHaveAttribute("aria-checked", "false")
  })

  test("Shift+klik memilih rentang", async ({ page }) => {
    await gotoHosts(page)
    const boxes = hostRows(page).locator("td:first-child").getByRole("checkbox")
    await boxes.nth(1).click()
    await boxes.nth(4).click({ modifiers: ["Shift"] })
    for (const i of [1, 2, 3, 4]) await expect(boxes.nth(i)).toHaveAttribute("aria-checked", "true")
    await expect(boxes.nth(0)).toHaveAttribute("aria-checked", "false")
    await expect(boxes.nth(5)).toHaveAttribute("aria-checked", "false")
    await expect(page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })).toContainText("4 host dipilih")
  })

  test("checkbox header: semua / indeterminate; tersembunyi oleh filter", async ({ page }) => {
    await gotoHosts(page)
    const total = await hostRows(page).count()
    const header = page.getByRole("checkbox", { name: "Pilih semua host" })
    await header.click()
    await expect(header).toHaveAttribute("aria-checked", "true")
    const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
    await expect(bar).toContainText(`${total} host dipilih`)
    await page.getByRole("checkbox", { name: "Pilih node01" }).click()
    await expect(header).toHaveAttribute("aria-checked", "mixed")
    await expect(bar).toContainText(`${total - 1} host dipilih`)
    // Klik saat indeterminate → pilih semua lagi; klik berikutnya → kosong.
    await header.click()
    await expect(header).toHaveAttribute("aria-checked", "true")
    await header.click()
    await expect(header).toHaveAttribute("aria-checked", "false")
    await expect(bar).toBeHidden()

    await page.getByRole("checkbox", { name: "Pilih node01" }).click()
    await page.getByRole("checkbox", { name: "Pilih ctrl-01" }).click()
    await page.getByLabel("Cari host").fill("node01")
    await expect(bar).toContainText("2 host dipilih")
    await expect(bar).toContainText("(1 tersembunyi oleh filter)")
    await page.screenshot({ path: SHOTS(2, "ac-2.11-hidden-by-filter") })
  })
})

test.describe("AC-2.12 menu aksi baris", () => {
  test("berisi tepat lima aksi", async ({ page }) => {
    await gotoHosts(page)
    await page.getByRole("button", { name: "Aksi untuk node01" }).click()
    await expect(page.getByRole("menuitem")).toHaveText(["Install OS", "Edit konfigurasi", "Lihat log", "Reboot ke PXE", "Hapus"])
  })

  test("Hapus: Batal tidak mengubah apa pun; konfirmasi menghapus baris + toast", async ({ page }) => {
    await gotoHosts(page)
    const before = await hostRows(page).count()
    const requests: string[] = []
    page.on("request", (r) => r.method() === "DELETE" && requests.push(r.url()))
    await page.getByRole("button", { name: "Aksi untuk win-jump" }).click()
    await page.getByRole("menuitem", { name: "Hapus" }).click()
    const dlg = page.getByRole("alertdialog", { name: "Hapus host?" })
    await expect(dlg).toContainText("00:50:56:b2:3e:91")
    await dlg.getByRole("button", { name: "Batal" }).click()
    await expect(dlg).toBeHidden()
    await expect(hostRows(page)).toHaveCount(before)
    expect(requests).toEqual([])

    await page.getByRole("button", { name: "Aksi untuk win-jump" }).click()
    await page.getByRole("menuitem", { name: "Hapus" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Hapus" }).click()
    await expect(rowByMac(page, "00:50:56:b2:3e:91")).toHaveCount(0)
    await expect(hostRows(page)).toHaveCount(before - 1)
    await expect(page.getByText("win-jump dihapus dari daftar")).toBeVisible()
    expect(requests).toEqual([expect.stringMatching(/\/api\/hosts\/005056b23e91$/)])
    expect((await page.request.get("/api/hosts/005056b23e91")).status()).toBe(404)
    await page.screenshot({ path: SHOTS(2, "ac-2.12-deleted-toast") })
  })

  test("Reboot ke PXE → AlertDialog → status baris berubah", async ({ page }) => {
    await gotoHosts(page)
    const row = rowByMac(page, "3c:a8:2a:10:44:7c") // legacy-01, done, tanpa OS tugasan
    await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "done")
    await page.getByRole("button", { name: "Aksi untuk legacy-01" }).click()
    await page.getByRole("menuitem", { name: "Reboot ke PXE" }).click()
    const dlg = page.getByRole("alertdialog", { name: "Reboot ke PXE?" })
    await expect(dlg).toContainText("Belum ada OS yang ditugaskan")
    await dlg.getByRole("button", { name: "Reboot" }).click()
    await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "discovered")
    await expect(page.getByText("legacy-01 di-reboot ke PXE")).toBeVisible()

    const failed = rowByMac(page, "ac:1f:6b:22:7d:40") // compute-03, failed, OS tugasan → booting
    await page.getByRole("button", { name: "Aksi untuk compute-03" }).click()
    await page.getByRole("menuitem", { name: "Reboot ke PXE" }).click()
    await expect(page.getByRole("alertdialog")).toContainText("OS yang ditugaskan akan di-install")
    await page.getByRole("alertdialog").getByRole("button", { name: "Reboot" }).click()
    await expect(failed.locator("[data-status]")).toHaveAttribute("data-status", "booting")
  })

  test("Lihat log → /jobs?host=<id>", async ({ page }) => {
    await gotoHosts(page)
    await page.getByRole("button", { name: "Aksi untuk node01" }).click()
    await page.getByRole("menuitem", { name: "Lihat log" }).click()
    await expect(page).toHaveURL(/\/jobs\?host=525400101011$/)
  })

  test("Install OS / Edit konfigurasi membuka Sheet", async ({ page }) => {
    await gotoHosts(page)
    for (const [item, tab] of [["Install OS", "OS"], ["Edit konfigurasi", "OS"]]) {
      await page.getByRole("button", { name: "Aksi untuk ctrl-02" }).click()
      await page.getByRole("menuitem", { name: item }).click()
      const sheet = page.getByRole("dialog", { name: "Konfigurasi ctrl-02" })
      await expect(sheet).toBeVisible()
      await expect(sheet.getByRole("tab", { name: new RegExp(`^${tab}`) })).toHaveAttribute("aria-selected", "true")
      // Install OS menandai bagian OS untuk disimpan; Edit belum ada perubahan.
      await expect(sheet).toContainText(item === "Install OS" ? "Akan disimpan:" : "Belum ada perubahan.")
      await page.keyboard.press("Escape")
      await expect(sheet).toBeHidden()
    }
  })
})

test.describe("AC-2.13 empty & error state", () => {
  test("{hosts: []} → 'Belum ada host' + penjelasan PXE boot", async ({ page }) => {
    await page.route("**/api/hosts", (r) => r.fulfill({ json: { hosts: [], serverTime: new Date().toISOString() } }))
    await page.goto("/hosts")
    await expect(page.getByText("Belum ada host")).toBeVisible()
    await expect(page.locator('[data-slot="empty-description"]')).toContainText("Host akan muncul otomatis di sini saat melakukan PXE boot")
    await expect(page.locator("main table")).toHaveCount(0)
    await page.screenshot({ path: SHOTS(2, "ac-2.13-empty") })
  })

  test("GET /api/hosts 500 → Alert 'Gagal memuat data host'", async ({ page }) => {
    await page.route("**/api/hosts", (r) => r.fulfill({ status: 500, json: { error: "Server mock mati" } }))
    await page.goto("/hosts")
    const alert = page.getByRole("alert").filter({ hasText: "Gagal memuat data host" })
    await expect(alert).toBeVisible({ timeout: 10_000 })
    await expect(alert).toContainText("Server mock mati")
    await page.screenshot({ path: SHOTS(2, "ac-2.13-error") })
  })
})

test.describe("AC-2.14 copy MAC", () => {
  test("tombol copy terlihat saat fokus keyboard dan menulis MAC ke clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await gotoHosts(page)
    const row = rowByMac(page, "52:54:00:10:10:11")
    const copy = row.getByRole("button", { name: "Salin MAC" })
    await page.getByLabel("Cari host").focus()
    await page.mouse.move(0, 0)
    await expect(copy).toHaveCSS("opacity", "0")
    // Fokus dengan keyboard: dari checkbox baris, Tab berikutnya = tombol copy.
    await row.getByRole("checkbox").focus()
    await page.keyboard.press("Tab")
    await expect(copy).toBeFocused()
    await expect(copy).toHaveCSS("opacity", "1")
    await page.keyboard.press("Enter")
    await expect(copy).toHaveAttribute("data-copied", "true")
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("52:54:00:10:10:11")
    await page.screenshot({ path: SHOTS(2, "ac-2.14-copy") })
  })
})
