// Iterasi 2 — perilaku UI baru dari perbaikan review iter1 (server sendiri, project "iter2-ui",
// env PXE_MGMT_* = subnet lab):
//  - CR-3-6  dialog password sekali tampil tidak bisa ditutup sebelum unduh/konfirmasi.
//  - CR-3-13 Sheet: error state + "Coba lagi" bila config host / parameter jaringan gagal dimuat.
//  - CR-3-2  form & empty state memakai nilai dari GET /api/network (bukan konstanta lab).
//  - CR-2-4  pencarian MAC gaya Cisco; CR-2-3 host tanpa hostname di akhir saat sort.
//  - DR-2-1/2-2 kontrol 36px; DR-3-2 radius Sheet 12px; DR-3-3 tombol kecil Sheet.
import { readFileSync } from "node:fs"

import { expect, test, type Page } from "@playwright/test"

import { gotoHosts, hostRows, hostsTable, rowByMac, SHOTS } from "./helpers"

const BULK = ["b0:83:fe:5c:19:e2", "b0:83:fe:5c:19:e3", "a0:36:9f:0b:72:5d"]

async function select(page: Page, macsOrNames: string[]) {
  for (const m of macsOrNames) await page.getByRole("checkbox", { name: `Pilih ${m}` }).click()
  const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
  await expect(bar).toContainText(`${macsOrNames.length} host dipilih`)
  return bar
}

async function clearSelection(page: Page) {
  await page.getByRole("toolbar", { name: "Aksi untuk host terpilih" }).getByRole("button", { name: "Batalkan pilihan" }).click()
  await expect(page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })).toBeHidden()
}

/** Simpan credentials acak untuk host terpilih → dialog password. */
async function saveRandomPasswords(page: Page, hosts: string[], username: string) {
  const bar = await select(page, hosts)
  await bar.getByRole("button", { name: "Set Credentials" }).click()
  const sheet = page.getByRole("dialog", { name: `Konfigurasi ${hosts.length} host` })
  await sheet.getByRole("radio", { name: "Password acak per host" }).click()
  await sheet.locator("#cred-user").fill(username)
  const res = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/hosts/bulk"))
  await sheet.getByRole("button", { name: "Simpan konfigurasi" }).click()
  expect((await res).status()).toBe(200)
  const dlg = page.getByRole("dialog", { name: "Password acak dibuat" })
  await expect(dlg).toBeVisible()
  return dlg
}

test.describe("CR-3-6 dialog password sekali tampil", () => {
  test("tidak bisa ditutup (Escape/overlay/tanpa tombol X) sebelum unduh atau konfirmasi; Selesai aktif setelah centang", async ({ page }) => {
    await gotoHosts(page)
    const dlg = await saveRandomPasswords(page, BULK, "opsdlg")
    const pwCells = dlg.getByRole("table", { name: "Password yang dibuat" }).locator("tbody td:nth-child(3)")
    await expect(pwCells).toHaveCount(3)
    const done = dlg.getByRole("button", { name: "Selesai" })
    const confirm = dlg.getByRole("checkbox", { name: "Saya sudah menyimpan password" })

    // Tanpa tombol close (X) dan tanpa "Tutup tanpa mengunduh".
    await expect(dlg.locator('[data-slot="dialog-close"]')).toHaveCount(0)
    await expect(dlg.getByRole("button", { name: /close|tutup/i })).toHaveCount(0)
    await expect(done).toBeDisabled()
    await expect(confirm).not.toBeChecked()
    await page.screenshot({ path: SHOTS(3, "iter2-passwords-dialog-locked"), mask: [pwCells] })

    // Escape dan klik overlay tidak menutup.
    await page.keyboard.press("Escape")
    await expect(dlg).toBeVisible()
    await page.mouse.click(8, 8)
    await expect(dlg).toBeVisible()
    await page.mouse.click(1430, 890)
    await expect(dlg).toBeVisible()
    // Klik "Selesai" yang nonaktif juga tidak menutup.
    await done.click({ force: true })
    await expect(dlg).toBeVisible()

    // Centang konfirmasi → Selesai aktif; hapus centang → nonaktif lagi.
    await confirm.click()
    await expect(confirm).toBeChecked()
    await expect(done).toBeEnabled()
    await confirm.click()
    await expect(done).toBeDisabled()
    await dlg.getByText("Saya sudah menyimpan password").click() // label juga mengubah checkbox
    await expect(done).toBeEnabled()
    await done.click()
    await expect(dlg).toBeHidden()
  })

  test("Selesai aktif setelah unduh CSV; batch berikutnya terkunci lagi (state di-reset); CSV aman formula", async ({ page }) => {
    await gotoHosts(page)
    const dlg = await saveRandomPasswords(page, BULK.slice(0, 2), "opsdl")
    const done = dlg.getByRole("button", { name: "Selesai" })
    await expect(done).toBeDisabled()
    const [download] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "Unduh CSV" }).click()])
    await expect(done).toBeEnabled()
    // Setelah unduh, opsi konfirmasi tidak diperlukan lagi.
    await expect(dlg.getByRole("checkbox", { name: "Saya sudah menyimpan password" })).toHaveCount(0)
    const lines = readFileSync((await download.path())!, "utf8").trim().split("\r\n")
    expect(lines[0]).toBe("mac,hostname,username,password")
    expect(lines).toHaveLength(3)
    // SR-3-1: tidak ada sel yang diawali karakter formula spreadsheet.
    for (const line of lines.slice(1)) for (const cell of line.split(",")) expect(cell).not.toMatch(/^[=+\-@\t\r]/)
    // Setelah boleh ditutup, Escape menutup dialog.
    await page.keyboard.press("Escape")
    await expect(dlg).toBeHidden()

    // Batch kedua (host lain): dialog baru kembali terkunci.
    await clearSelection(page).catch(() => undefined)
    const dlg2 = await saveRandomPasswords(page, BULK.slice(1), "opsdl2")
    await expect(dlg2.getByRole("button", { name: "Selesai" })).toBeDisabled()
    await expect(dlg2.getByRole("checkbox", { name: "Saya sudah menyimpan password" })).not.toBeChecked()
    await page.keyboard.press("Escape")
    await expect(dlg2).toBeVisible()
    await dlg2.getByRole("checkbox", { name: "Saya sudah menyimpan password" }).click()
    await dlg2.getByRole("button", { name: "Selesai" }).click()
    await expect(dlg2).toBeHidden()
  })
})

test.describe("CR-3-13 Sheet error state + Coba lagi", () => {
  test("GET config host gagal → alert, form tidak dirender; Coba lagi memuat ulang form", async ({ page }) => {
    let configCalls = 0
    await page.route("**/api/hosts/525400101011/config", (r) => {
      configCalls++
      return r.fulfill({ status: 500, json: { error: "Config rusak (uji)" } })
    })
    await gotoHosts(page)
    await page.getByRole("button", { name: "Aksi untuk node01" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog", { name: /Konfigurasi node01/ })
    const alert = sheet.getByRole("alert").filter({ hasText: "Gagal memuat konfigurasi host" })
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert).toContainText("Config rusak (uji)")
    await expect(alert).toContainText("Form tidak ditampilkan agar nilai tersimpan tidak tertimpa default")
    // Form (tab, input, tombol simpan) tidak dirender dari nilai default.
    await expect(sheet.getByRole("tab")).toHaveCount(0)
    await expect(sheet.getByRole("button", { name: "Simpan konfigurasi" })).toHaveCount(0)
    await expect(sheet.locator("#cred-pass")).toHaveCount(0)
    await page.screenshot({ path: SHOTS(3, "iter2-sheet-config-error") })

    expect(configCalls).toBeGreaterThanOrEqual(1)
    const before = configCalls
    await page.unroute("**/api/hosts/525400101011/config")
    const refetch = page.waitForResponse((r) => r.url().endsWith("/api/hosts/525400101011/config") && r.request().method() === "GET")
    await alert.getByRole("button", { name: "Coba lagi" }).click()
    expect((await refetch).status()).toBe(200)
    expect(configCalls).toBe(before)
    await expect(sheet.getByRole("tab")).toHaveText(["OS", "Credentials", "Network", "Hostname", "SSH Keys"])
    await expect(alert).toHaveCount(0)
    await sheet.getByRole("tab", { name: /^Network/ }).click()
    await expect(sheet.locator("#net-ip")).toHaveValue("10.10.10.11")
  })

  test("GET /api/network gagal → alert 'Gagal memuat parameter jaringan'; Coba lagi → form dengan default subnet", async ({ page }) => {
    await page.route("**/api/network", (r) => r.fulfill({ status: 500, json: { error: "PXE_MGMT_GATEWAY rusak (uji)" } }))
    await gotoHosts(page)
    const bar = await select(page, BULK)
    await bar.getByRole("button", { name: "Set IP" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
    const alert = sheet.getByRole("alert").filter({ hasText: "Gagal memuat parameter jaringan" })
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert).toContainText("PXE_MGMT_GATEWAY rusak (uji)")
    await expect(sheet.getByRole("tab")).toHaveCount(0)
    await expect(sheet.getByRole("table", { name: "Preview IP baru" })).toHaveCount(0)
    await page.screenshot({ path: SHOTS(3, "iter2-sheet-network-error") })

    await page.unroute("**/api/network")
    await alert.getByRole("button", { name: "Coba lagi" }).click()
    await expect(sheet.getByRole("tab", { name: /^Network/ })).toHaveAttribute("aria-selected", "true")
    await expect(sheet.locator("#net-start")).toHaveValue("10.10.10.11")
    await expect(sheet.locator("#net-end")).toHaveValue("10.10.10.99")
  })
})

test.describe("CR-3-2 form & tampilan memakai GET /api/network", () => {
  const CUSTOM = {
    cidr: "192.168.50.0/24",
    prefix: 24,
    gateway: "192.168.50.1",
    dns: ["192.168.50.53"],
    dynamicRange: ["192.168.50.100", "192.168.50.200"],
    pxeServer: "192.168.50.2",
  }

  test("server lab: /api/network = env PXE_MGMT_* lab; sidebar & empty state memakai nilainya", async ({ page }) => {
    const res = await page.request.get("/api/network")
    expect(res.status()).toBe(200)
    expect(res.headers()["cache-control"]).toBe("no-store")
    expect(await res.json()).toEqual({
      cidr: "10.10.10.0/24",
      prefix: 24,
      gateway: "10.10.10.1",
      dns: ["10.10.10.1"],
      dynamicRange: ["10.10.10.100", "10.10.10.200"],
      pxeServer: "10.10.10.1",
    })
    await page.route("**/api/hosts", (r) => r.fulfill({ json: { hosts: [], serverTime: new Date().toISOString() } }))
    await page.goto("/hosts")
    await expect(page.locator('[data-slot="empty-description"]')).toContainText("jaringan provisioning 10.10.10.0/24")
    await expect(page.locator('[data-slot="sidebar"]').getByText("10.10.10.1", { exact: true })).toBeVisible()
  })

  test("respons /api/network lain → default range, gateway, DNS, preview IP, validasi, deskripsi, sidebar ikut", async ({ page }) => {
    const seen: string[] = []
    await page.route("**/api/network", (r) => {
      seen.push(r.request().url())
      return r.fulfill({ json: CUSTOM, headers: { "cache-control": "no-store" } })
    })
    await gotoHosts(page)
    expect(seen.length).toBeGreaterThan(0)
    await expect(page.locator('[data-slot="sidebar"]').getByText("192.168.50.2", { exact: true })).toBeVisible()

    const bar = await select(page, BULK)
    await bar.getByRole("button", { name: "Set IP" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
    await expect(sheet.locator("#net-start")).toHaveValue("192.168.50.11")
    await expect(sheet.locator("#net-end")).toHaveValue("192.168.50.99")
    await expect(sheet.locator("#net-gw")).toHaveValue("192.168.50.1")
    await expect(sheet.getByRole("button", { name: "Hapus DNS 192.168.50.53" })).toBeVisible()
    const ipRows = sheet.getByRole("table", { name: "Preview IP baru" }).locator("tbody tr")
    await expect(ipRows.locator("td:nth-child(3)")).toHaveText(["192.168.50.11", "192.168.50.12", "192.168.50.13"])
    await expect(sheet.getByRole("table", { name: "Preview IP baru" }).locator('tbody tr[data-state="ok"]')).toHaveCount(3)
    // IP lab kini di luar subnet aktif (validasi klien ikut /api/network).
    await sheet.getByRole("radio", { name: "IP awal + increment" }).click()
    await sheet.locator("#net-start").fill("10.10.10.11")
    await expect(ipRows.first()).toContainText("IP awal di luar subnet 192.168.50.0/24")
    await expect(sheet.getByRole("button", { name: "Simpan konfigurasi" })).toBeDisabled()
    await page.screenshot({ path: SHOTS(3, "iter2-form-network-from-api") })
    await page.keyboard.press("Escape")
    await clearSelection(page)

    // Single host: deskripsi subnet + range dinamis + placeholder dari /api/network.
    await page.getByRole("button", { name: "Aksi untuk node01" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const single = page.getByRole("dialog", { name: /Konfigurasi node01/ })
    await single.getByRole("tab", { name: /^Network/ }).click()
    await single.locator("#net-ip").fill("")
    await expect(single.locator("#net-ip")).toHaveAttribute("placeholder", "192.168.50.11")
    await single.locator("#net-ip").fill("192.168.50.150")
    await expect(single.locator('[data-slot="field-error"]').first()).toHaveText(
      "Di dalam range DHCP dinamis 192.168.50.100–192.168.50.200",
    )
    await single.locator("#net-ip").fill("192.168.50.20")
    await expect(single).toContainText("Di dalam 192.168.50.0/24, di luar range dinamis 192.168.50.100–192.168.50.200")
  })
})

test.describe("CR-2-4 / CR-2-3 tabel host", () => {
  test("pencarian MAC Cisco 5254.0010.1011 → hanya node01; query IP tidak cocok dengan digit MAC", async ({ page }) => {
    await gotoHosts(page)
    const search = page.getByLabel("Cari host")
    await search.fill("5254.0010.1011")
    await expect(hostRows(page)).toHaveCount(1)
    await expect(hostRows(page).first()).toContainText("52:54:00:10:10:11")
    await search.fill("5254.0010")
    await expect(rowByMac(page, "52:54:00:10:10:11")).toHaveCount(1)
    await search.fill("b083.fe5c.19e2")
    await expect(hostRows(page)).toHaveCount(1)
    await expect(hostRows(page).first()).toContainText("b0:83:fe:5c:19:e2")
    await page.screenshot({ path: SHOTS(2, "iter2-search-cisco-mac") })
  })

  test("sort Hostname naik & turun: host tanpa hostname ('—') selalu di akhir", async ({ page }) => {
    await gotoHosts(page)
    const header = hostsTable(page).locator("thead").getByRole("button", { name: /^Hostname/ })
    const names = async () => (await hostRows(page).locator("td:nth-child(3)").allTextContents()).map((t) => t.trim())
    /** null bila urutan benar untuk `dir`, selain itu alasan (untuk pesan gagal). */
    const problem = (list: string[], dir: "asc" | "desc") => {
      const firstDash = list.indexOf("—")
      if (firstDash <= 0) return `tidak ada nama sebelum "—": ${list.join(",")}`
      if (!list.slice(firstDash).every((n) => n === "—")) return `"—" tidak di ekor: ${list.join(",")}`
      const named = list.slice(0, firstDash)
      const sorted = [...named].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      if (dir === "desc") sorted.reverse()
      return JSON.stringify(named) === JSON.stringify(sorted) ? null : `urutan ${dir} salah: ${named.join(",")}`
    }
    expect(await names()).toContain("—")
    for (const dir of ["asc", "desc"] as const) {
      await header.click()
      await expect.poll(async () => problem(await names(), dir)).toBeNull()
    }
  })
})

test.describe("DR-2-1/2-2, DR-3-2, DR-3-3 ukuran & radius", () => {
  test("toolbar & bulk bar 36px; Sheet radius 12px di sisi konten; tombol kecil Sheet ≥ 32px", async ({ page }) => {
    await gotoHosts(page)
    // Dibulatkan ke piksel: layout bisa menghasilkan 35.9999 (subpiksel).
    const h = async (loc: ReturnType<Page["locator"]>) => Math.round((await loc.boundingBox())!.height)
    expect(await h(page.getByRole("combobox", { name: "Filter OS" }))).toBe(36)
    expect(await h(page.locator('[data-slot="input-group"]').filter({ has: page.getByLabel("Cari host") }))).toBe(36)
    const bar = await select(page, ["node01", "ctrl-01"])
    for (const name of ["Set Credentials", "Set Hostname", "Set IP", "Inject SSH Key", "Install OS", "Batalkan pilihan"])
      expect(await h(bar.getByRole("button", { name })), name).toBe(36)
    expect(Math.round((await bar.getByRole("button", { name: "Batalkan pilihan" }).boundingBox())!.width)).toBe(36)

    await bar.getByRole("button", { name: "Set IP" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 2 host" })
    await expect(sheet).toBeVisible()
    const r = await page.locator('[data-slot="sheet-content"]').evaluate((el) => {
      const cs = getComputedStyle(el)
      return { tl: cs.borderTopLeftRadius, bl: cs.borderBottomLeftRadius, tr: cs.borderTopRightRadius, br: cs.borderBottomRightRadius }
    })
    expect(r).toEqual({ tl: "12px", bl: "12px", tr: "0px", br: "0px" })
    // Tombol "Tambah" DNS dan area klik "Hapus DNS …" ≥ 32px (sebelumnya 24px).
    await sheet.locator("#net-dns").fill("1.1.1.1")
    const add = sheet.getByRole("button", { name: "Tambah" })
    expect(await h(add)).toBeGreaterThanOrEqual(32)
    const removeHit = await sheet.getByRole("button", { name: "Hapus DNS 10.10.10.1" }).evaluate((el) => {
      const a = getComputedStyle(el, "::after")
      return { pos: a.position, content: a.content, w: el.getBoundingClientRect().width + 2 * -parseFloat(a.left), h: el.getBoundingClientRect().height + 2 * -parseFloat(a.top) }
    })
    expect(removeHit.pos).toBe("absolute")
    expect(removeHit.w).toBeGreaterThanOrEqual(32)
    expect(removeHit.h).toBeGreaterThanOrEqual(32)
    await page.screenshot({ path: SHOTS(3, "iter2-sheet-radius-controls") })
  })
})
