// M3 E2E bulk: AC-3.14 (preview & password sekali tampil), AC-3.15 (Simpan & Install).
// CR-2-9: server sendiri (project "m3-bulk"), store segar dari seed.
import { readFileSync } from "node:fs"

import { expect, test, type Page, type Request } from "@playwright/test"

import { DUMMY_PASSWORD } from "../src/test/fixtures"
import { gotoHosts, ORANGE, rowByMac, SHOTS } from "./helpers"

const BULK = ["b0:83:fe:5c:19:e2", "b0:83:fe:5c:19:e3", "a0:36:9f:0b:72:5d"]

/** Request yang menyimpan/menginstal (bukan GET/validasi CSV). */
function trackSaves(page: Page) {
  const saves: string[] = []
  page.on("request", (r: Request) => {
    const u = new URL(r.url())
    if (r.method() === "PATCH" || (r.method() === "POST" && /^\/api\/hosts(\/|$)/.test(u.pathname)))
      saves.push(`${r.method()} ${u.pathname}`)
  })
  return saves
}

/**
 * CR-3-11: buktikan TIDAK ada request simpan/instal dalam jendela `ms` dengan menunggu event
 * request (gagal begitu request terkirim), bukan jeda tetap lalu cek daftar.
 */
async function expectNoSaveRequest(page: Page, saves: string[], ms = 1_500) {
  const isSave = (r: Request) => {
    const u = new URL(r.url())
    return r.method() === "PATCH" || (r.method() === "POST" && /^\/api\/hosts(\/|$)/.test(u.pathname))
  }
  const got = await page.waitForRequest(isSave, { timeout: ms }).then(
    (r) => `${r.method()} ${new URL(r.url()).pathname}`,
    () => null,
  )
  expect(got).toBeNull()
  expect(saves).toEqual([])
}

async function selectBulk(page: Page) {
  for (const mac of BULK) await page.getByRole("checkbox", { name: `Pilih ${mac}` }).click()
  const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
  await expect(bar).toContainText("3 host dipilih")
  return bar
}

test("AC-3.14 preview bulk (IP, hostname, CSV) tanpa request simpan; password acak sekali tampil + CSV", async ({ page }) => {
  const saves = trackSaves(page)
  await gotoHosts(page)
  const bar = await selectBulk(page)
  // Urutan host di Sheet = urutan tampilan tabel.
  const order: string[] = []
  for (const row of await page.locator("main table").first().locator("tbody tr").all()) {
    const text = (await row.locator("td").nth(1).textContent())!.trim()
    if (BULK.includes(text)) order.push(text)
  }
  expect([...order].sort()).toEqual([...BULK].sort())

  // ---- Set IP: preview MAC → IP (range lalu IP awal + increment) ----
  await bar.getByRole("button", { name: "Set IP" }).click()
  const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
  await expect(sheet.getByRole("tab", { name: /^Network/ })).toHaveAttribute("aria-selected", "true")
  const ipPreview = sheet.getByRole("table", { name: "Preview IP baru" })
  const ipRows = ipPreview.locator("tbody tr")
  await expect(ipRows).toHaveCount(3)
  const macsInPreview = (await ipRows.locator("td:first-child").allTextContents()).map((t) => t.trim())
  // CR-3-10: urutan baris preview = urutan tampilan tabel (tanpa sort di kedua sisi).
  expect(macsInPreview).toEqual(order)
  // Range default 10.10.10.11–99: .11 dipakai node01 → dilewati.
  await expect(ipRows.locator("td:nth-child(3)")).toHaveText(["10.10.10.12", "10.10.10.13", "10.10.10.14"])
  await expect(ipRows.locator('[data-state="ok"]')).toHaveCount(0)
  await expect(ipPreview.locator('tbody tr[data-state="ok"]')).toHaveCount(3)
  await sheet.getByRole("radio", { name: "IP awal + increment" }).click()
  await sheet.locator("#net-start").fill("10.10.10.70")
  await sheet.locator("#net-step").fill("5")
  await expect(ipRows.locator("td:nth-child(3)")).toHaveText(["10.10.10.70", "10.10.10.75", "10.10.10.80"])
  await sheet.locator("#net-start").fill("10.10.10.21") // IP ctrl-01: dilewati
  await expect(ipRows.locator("td:nth-child(3)")).toHaveText(["10.10.10.26", "10.10.10.36", "10.10.10.46"])
  await page.screenshot({ path: SHOTS(3, "ac-3.14-ip-preview") })
  await page.keyboard.press("Escape")
  await expect(sheet).toBeHidden()

  // ---- Set Hostname: template node-{index:02} + tanda duplikat ----
  await bar.getByRole("button", { name: "Set Hostname" }).click()
  await expect(sheet.getByRole("tab", { name: /^Hostname/ })).toHaveAttribute("aria-selected", "true")
  const hnRows = sheet.getByRole("table", { name: "Preview Hostname baru" }).locator("tbody tr")
  expect((await hnRows.locator("td:first-child").allTextContents()).map((t) => t.trim())).toEqual(order)
  await expect(sheet.locator("#hn-template")).toHaveValue("node-{index:02}")
  await expect(hnRows.locator("td:nth-child(3) span.type-data")).toHaveText(["node-01", "node-02", "node-03"])
  await sheet.locator("#hn-start").fill("7")
  await expect(hnRows.locator("td:nth-child(3) span.type-data")).toHaveText(["node-07", "node-08", "node-09"])
  await sheet.locator("#hn-template").fill("rack-a")
  await expect(hnRows.filter({ hasText: "Duplikat dalam batch" })).toHaveCount(2)
  await expect(sheet.getByRole("table", { name: "Preview Hostname baru" }).locator('tbody tr[data-state="error"]')).toHaveCount(2)
  await expect(sheet).toContainText("2 bermasalah")
  await expect(sheet.getByRole("button", { name: "Simpan konfigurasi" })).toBeDisabled()
  await page.screenshot({ path: SHOTS(3, "ac-3.14-hostname-preview") })
  await page.keyboard.press("Escape")

  // ---- Set Credentials mode CSV: preview per baris + error per baris ----
  await bar.getByRole("button", { name: "Set Credentials" }).click()
  await expect(sheet.getByRole("tab", { name: /^Credentials/ })).toHaveAttribute("aria-selected", "true")
  await sheet.getByRole("radio", { name: "Import CSV" }).click()
  const csv = [
    "mac,username,password",
    `${BULK[0]},ops,${DUMMY_PASSWORD}`,
    `${BULK[1]},Root,pendek`,
    `52:54:00:10:10:11,ops,${DUMMY_PASSWORD}`,
  ].join("\n")
  await sheet.locator("#cred-csv").fill(csv)
  await sheet.getByRole("button", { name: "Validasi CSV" }).click()
  const csvTable = sheet.getByRole("table", { name: "Preview CSV credentials" })
  await expect(csvTable.locator("tbody tr")).toHaveCount(3)
  await expect(csvTable.locator('tr[data-line="2"]')).toHaveAttribute("data-state", "ok")
  await expect(csvTable.locator('tr[data-line="3"]')).toHaveAttribute("data-state", "error")
  await expect(csvTable.locator('tr[data-line="3"]')).toContainText("Password: Minimal 8 karakter")
  await expect(csvTable.locator('tr[data-line="4"]')).toContainText("MAC bukan host terpilih")
  await expect(sheet).toContainText("1 valid · 2 tidak valid")
  await expect(sheet).toContainText("2 baris CSV tidak valid")
  await expect(sheet.getByRole("button", { name: "Simpan konfigurasi" })).toBeDisabled()
  await expect(csvTable).not.toContainText(DUMMY_PASSWORD)
  await page.screenshot({ path: SHOTS(3, "ac-3.14-csv-preview") })

  // Belum ada request simpan sama sekali.
  expect(saves).toEqual([])

  // ---- Mode password acak → simpan → dialog sekali tampil + unduh CSV ----
  await sheet.getByRole("radio", { name: "Password acak per host" }).click()
  await sheet.locator("#cred-user").fill("opsbulk")
  const saveReq = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/hosts/bulk"))
  await sheet.getByRole("button", { name: "Simpan konfigurasi" }).click()
  const body = (await saveReq).postDataJSON()
  // Urutan hostIds di payload juga mengikuti urutan tabel.
  expect(body.hostIds).toEqual(order.map((m) => m.replaceAll(":", "")))
  expect(body.credentials).toMatchObject({ mode: "random", username: "opsbulk", length: 16 })
  expect(Object.keys(body)).toEqual(["hostIds", "credentials"])

  const dlg = page.getByRole("dialog", { name: "Password acak dibuat" })
  await expect(dlg).toBeVisible()
  const pwRows = dlg.getByRole("table", { name: "Password yang dibuat" }).locator("tbody tr")
  await expect(pwRows).toHaveCount(3)
  const shown = (await pwRows.locator("td:nth-child(3)").allTextContents()).map((t) => t.trim())
  expect(new Set(shown).size).toBe(3)
  for (const p of shown) expect(p).toHaveLength(16)
  await page.screenshot({ path: SHOTS(3, "ac-3.14-passwords-dialog"), mask: [pwRows.locator("td:nth-child(3)")] })

  const [download] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "Unduh CSV" }).click()])
  expect(download.suggestedFilename()).toMatch(/^pxe-passwords-.*\.csv$/)
  const text = readFileSync((await download.path())!, "utf8")
  const lines = text.trim().split("\r\n")
  expect(lines[0]).toBe("mac,hostname,username,password")
  expect(lines).toHaveLength(4)
  for (const line of lines.slice(1)) {
    const [mac, hostname, user, pw] = line.split(",")
    expect(BULK).toContain(mac)
    expect(hostname).toBe("")
    expect(user).toBe("opsbulk")
    expect(shown).toContain(pw)
  }
  await dlg.getByRole("button", { name: "Selesai" }).click()
  await expect(dlg).toBeHidden()
  expect(saves).toEqual(["POST /api/hosts/bulk"])

  // Membuka ulang Sheet tidak menampilkan password lagi.
  await page.getByRole("checkbox", { name: `Pilih ${BULK[0]}` }).click()
  await page.getByRole("checkbox", { name: `Pilih ${BULK[1]}` }).click()
  await page.getByRole("checkbox", { name: `Pilih ${BULK[2]}` }).click()
  const bar2 = await selectBulk(page)
  await bar2.getByRole("button", { name: "Set Credentials" }).click()
  await expect(sheet).toBeVisible()
  for (const p of shown) await expect(page.locator("body")).not.toContainText(p)
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: `Aksi untuk ${BULK[0]}` }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const single = page.getByRole("dialog", { name: `Konfigurasi ${BULK[0]}` })
  await single.getByRole("tab", { name: /^Credentials/ }).click()
  await expect(single.locator("#cred-user")).toHaveValue("opsbulk")
  await expect(single.locator("#cred-pass")).toHaveValue("")
  await expect(single.locator("#cred-pass")).toHaveAttribute("placeholder", "kosongkan untuk mempertahankan password saat ini")
  for (const p of shown) await expect(page.locator("body")).not.toContainText(p)
  // API konfigurasi juga tidak memuat password.
  const cfg = await (await page.request.get(`/api/hosts/${BULK[0].replaceAll(":", "")}/config`)).text()
  for (const p of shown) expect(cfg).not.toContain(p)
  expect(JSON.parse(cfg).hasPassword).toBe(true)
})

test("AC-3.15 Simpan & Install: dialog konfirmasi, Batal tanpa request, install → Booting", async ({ page }) => {
  const saves = trackSaves(page)
  await gotoHosts(page)
  const row = rowByMac(page, "14:18:77:4a:2c:02") // ctrl-02, done, punya credentials
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "done")
  await page.getByRole("button", { name: "Aksi untuk ctrl-02" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: "Konfigurasi ctrl-02" })
  await sheet.locator("#os-disk").fill("/dev/sda")
  const installBtn = sheet.getByRole("button", { name: "Simpan & Install" })
  await expect(installBtn).toHaveAttribute("data-variant", "default")
  await expect(installBtn).toHaveCSS("background-color", ORANGE)
  await expect(sheet.getByRole("button", { name: "Simpan konfigurasi" })).toHaveAttribute("data-variant", "outline")

  await installBtn.click()
  const confirm = page.getByRole("alertdialog", { name: "Install OS ke ctrl-02?" })
  await expect(confirm).toContainText("Ubuntu Server 24.04.5 LTS akan di-install")
  await expect(confirm).toContainText("Seluruh isi disk target akan dihapus")
  await expect(confirm).toContainText("14:18:77:4a:2c:02 · ctrl-02")
  await page.screenshot({ path: SHOTS(3, "ac-3.15-confirm") })
  await confirm.getByRole("button", { name: "Batal" }).click()
  await expect(confirm).toBeHidden()
  await expectNoSaveRequest(page, saves)
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "done")

  await installBtn.click()
  const patched = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/api/hosts/1418774a2c02"))
  const installed = page.waitForResponse((r) => r.url().endsWith("/api/hosts/1418774a2c02/install"))
  await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
  expect((await patched).status()).toBe(200)
  expect((await installed).status()).toBe(200)
  expect(saves).toEqual(["PATCH /api/hosts/1418774a2c02", "POST /api/hosts/1418774a2c02/install"])
  await expect(sheet).toBeHidden()
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "booting")
  await expect(row.locator("[data-status]")).toHaveText("Booting")
  await expect(page.getByText("Instalasi dimulai di 1 host")).toBeVisible()
  await page.screenshot({ path: SHOTS(3, "ac-3.15-booting") })
  const cfg = await (await page.request.get("/api/hosts/1418774a2c02/config")).json()
  expect(cfg.os.disk).toBe("/dev/sda")
})

test("AC-3.15 bulk: dialog menyebut jumlah host; Batal tidak mengirim request", async ({ page }) => {
  const saves = trackSaves(page)
  await gotoHosts(page)
  await page.getByRole("checkbox", { name: "Pilih node01" }).click()
  await page.getByRole("checkbox", { name: "Pilih ctrl-01" }).click()
  await page.getByRole("toolbar", { name: "Aksi untuk host terpilih" }).getByRole("button", { name: "Install OS" }).click()
  const sheet = page.getByRole("dialog", { name: "Konfigurasi 2 host" })
  // OS wajib dipilih dulu untuk bulk.
  await expect(sheet.getByRole("button", { name: "Simpan & Install" })).toBeDisabled()
  await sheet.locator("#os-debian-12").click()
  await sheet.getByRole("button", { name: "Simpan & Install" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Install OS ke 2 host?" })
  await expect(confirm).toContainText("Debian 12 (bookworm) akan di-install")
  await expect(confirm).toContainText("Seluruh isi disk target akan dihapus")
  await expect(confirm.locator("li")).toHaveCount(2)
  await confirm.getByRole("button", { name: "Batal" }).click()
  await expect(confirm).toBeHidden()
  await expectNoSaveRequest(page, saves)
})
