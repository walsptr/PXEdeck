// M5-T13 E2E (server "m5-ui": subnet KVM, DB kosong, lease fixture, media palsu tanpa ubuntu-22.04).
// Perbaikan design carry-over M4:
//  - AC-5.29 DR-4-1 + DR-4-2: MAC/hostname di judul Sheet dan judul AlertDialog install = JetBrains
//            Mono; judul Sheet font-weight 600, ukuran 16–18 px
//  - AC-5.30 DR-4-3 + DR-4-4: install single ditolak saat Sheet terbuka → tanpa toast yang menutupi
//            footer Sheet, Alert di Sheet memuat pesan; bulk 1 sukses + 2 gagal → Sheet tetap terbuka,
//            Alert menyebut kedua host gagal (mono) + "1 host mulai diinstal", host sukses Booting
//  - AC-5.31 DR-4-5 + DR-4-6: alasan "tidak tersedia" di kartu OS = #807d72 saat image tidak
//            dipilih; alasan "Reboot ke PXE" kontras efektif ≥ 4,5:1 (warna + opacity terhitung)
import { expect, test, type Locator, type Page } from "@playwright/test"

import { rowByMac, SHOTS, waitForAnimations } from "./helpers"
import { HEX, leaseWriter, makeHost } from "./m5-support"
import { e2eLeaseFile } from "./support/e2e-env"

test.describe.configure({ mode: "serial" })

const lease = leaseWriter(e2eLeaseFile("m5-ui"))
const OK1 = { mac: "52:54:00:99:00:71", leaseIp: "10.99.0.171", staticIp: "10.99.0.71", hostname: "m5-ui-ok" }
const BAD1 = { mac: "52:54:00:99:00:72", leaseIp: "10.99.0.172", hostname: "m5-ui-bad1", credentials: false }
const BAD2 = { mac: "52:54:00:99:00:73", leaseIp: "10.99.0.173", hostname: "m5-ui-bad2", credentials: false }
const SOLO = { mac: "52:54:00:99:00:74", leaseIp: "10.99.0.174", credentials: false } // tanpa hostname → MAC di judul

test.beforeAll(async ({ request }) => {
  await makeHost(request, lease, { ...OK1, newKey: true })
  await makeHost(request, lease, BAD1)
  await makeHost(request, lease, BAD2)
  await makeHost(request, lease, SOLO)
})

const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function openSheet(page: Page, mac: string, item = "Install OS") {
  await rowByMac(page, mac).getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: item }).click()
  const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  await expect(sheet).toBeVisible()
  return sheet
}
const fontFamily = (l: Locator) => l.evaluate((e) => getComputedStyle(e).fontFamily)

test("AC-5.29 DR-4-1/4-2 judul Sheet & AlertDialog: host mono, Sheet 600 / 16–18 px", async ({ page }) => {
  await page.goto("/hosts")
  for (const [mac, label] of [[OK1.mac, OK1.hostname], [SOLO.mac, SOLO.mac]] as const) {
    const sheet = await openSheet(page, mac)
    const title = sheet.locator('[data-slot="sheet-title"]')
    await expect(title).toContainText(`Konfigurasi ${label}`)
    const host = title.getByTestId("sheet-title-host")
    await expect(host).toHaveText(label)
    expect(await fontFamily(host)).toMatch(/^"?JetBrains Mono/)
    expect(await fontFamily(title)).not.toMatch(/^"?JetBrains Mono/) // hanya nama host yang mono
    await expect(title).toHaveCSS("font-weight", "600")
    const size = parseFloat(await title.evaluate((e) => getComputedStyle(e).fontSize))
    expect(size).toBeGreaterThanOrEqual(16)
    expect(size).toBeLessThanOrEqual(18)
    await sheet.getByRole("button", { name: /^(Simpan & Install|Install)$/ }).click()
    const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
    const ch = confirm.getByTestId("install-confirm-host")
    await expect(ch).toHaveText(label)
    expect(await fontFamily(ch)).toMatch(/^"?JetBrains Mono/)
    if (mac === OK1.mac) await page.screenshot({ path: SHOTS(5, "ac-5.29-confirm-title") })
    await confirm.getByRole("button", { name: "Batal", exact: true }).click()
    await expect(confirm).toBeHidden()
    if (mac === OK1.mac) await page.screenshot({ path: SHOTS(5, "ac-5.29-sheet-title") })
    await sheet.getByRole("button", { name: "Batal", exact: true }).click()
    await expect(sheet).toBeHidden()
  }
})

test("AC-5.30 DR-4-3 install single ditolak: Alert di Sheet, tanpa toast yang menutupi footer", async ({ page }) => {
  await page.goto("/hosts")
  const sheet = await openSheet(page, SOLO.mac)
  await sheet.getByRole("button", { name: /^(Simpan & Install|Install)$/ }).click()
  const resp = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${SOLO.mac.replaceAll(":", "")}/install`))
  await page.getByRole("alertdialog", { name: /^Install OS ke / }).getByRole("button", { name: "Hapus disk & install" }).click()
  expect((await resp).status()).toBe(422)
  await expect(sheet).toBeVisible()
  const alert = sheet.locator('[data-slot="install-errors"]')
  await expect(alert).toBeVisible()
  await expect(alert).toContainText("Install ditolak untuk 1 host")
  await expect(alert).toContainText(/credentials|Credentials|password|kredensial/i)
  await page.waitForTimeout(800) // beri waktu toast (bila ada) untuk muncul
  const footer = await sheet.locator('[data-slot="sheet-footer"]').boundingBox()
  expect(footer).not.toBeNull()
  const toasts = page.locator("[data-sonner-toast]")
  const n = await toasts.count()
  for (let i = 0; i < n; i++) {
    const b = await toasts.nth(i).boundingBox()
    if (b) expect(intersects(b, footer!), `toast ${i} menutupi footer Sheet`).toBe(false)
  }
  expect(await rowByMac(page, SOLO.mac).locator("[data-status]").getAttribute("data-status")).toBe("discovered")
  await page.screenshot({ path: SHOTS(5, "ac-5.30-single-rejected") })
})

test("AC-5.30 DR-4-4 bulk 1 sukses + 2 gagal: Sheet tetap terbuka, Alert per host (mono) + ringkasan, host sukses Booting", async ({ page }) => {
  await page.goto("/hosts")
  for (const h of [OK1, BAD1, BAD2]) await page.getByRole("checkbox", { name: `Pilih ${h.hostname}` }).click()
  await page.getByRole("toolbar", { name: "Aksi untuk host terpilih" }).getByRole("button", { name: "Install OS" }).click()
  const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
  await sheet.locator('[id="os-ubuntu-24.04"]').click()
  await sheet.getByRole("button", { name: "Simpan & Install" }).click()
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/hosts/bulk/install"))
  await page.getByRole("alertdialog", { name: "Install OS ke 3 host?" }).getByRole("button", { name: "Hapus disk & install" }).click()
  const r = await resp
  expect(r.status()).toBe(200) // M4: 200 bila ≥ 1 host mulai (hasil per host di body)
  const body = await r.json()
  expect(body.started).toEqual([OK1.mac.replaceAll(":", "")])
  expect(body.failed.map((f: { hostId: string }) => f.hostId).sort()).toEqual([BAD1.mac, BAD2.mac].map((m) => m.replaceAll(":", "")).sort())

  await expect(sheet).toBeVisible()
  const alert = sheet.locator('[data-slot="install-errors"]')
  await expect(alert).toContainText("Install ditolak untuk 2 host")
  for (const h of [BAD1, BAD2]) {
    const name = alert.locator("li .type-data", { hasText: h.hostname })
    await expect(name).toHaveCount(1)
    expect(await fontFamily(name)).toMatch(/^"?JetBrains Mono/)
  }
  const started = alert.locator('[data-slot="install-started"]')
  await expect(started).toContainText("1 host mulai diinstal")
  await expect(started.locator(".type-data")).toHaveText(OK1.hostname)
  await page.waitForTimeout(800)
  const footer = await sheet.locator('[data-slot="sheet-footer"]').boundingBox()
  for (let i = 0; i < (await page.locator("[data-sonner-toast]").count()); i++) {
    const b = await page.locator("[data-sonner-toast]").nth(i).boundingBox()
    if (b) expect(intersects(b, footer!)).toBe(false)
  }
  await page.screenshot({ path: SHOTS(5, "ac-5.30-bulk-partial") })
  await expect(rowByMac(page, OK1.mac).locator("[data-status]")).toHaveAttribute("data-status", "booting", { timeout: 10_000 })
  for (const h of [BAD1, BAD2]) await expect(rowByMac(page, h.mac).locator("[data-status]")).toHaveAttribute("data-status", "discovered")
})

test("AC-5.31 DR-4-5 'tidak tersedia' muted #807d72; DR-4-6 alasan Reboot ke PXE kontras ≥ 4,5:1", async ({ page }) => {
  await page.goto("/hosts")
  const sheet = await openSheet(page, BAD1.mac, "Edit konfigurasi")
  const note = sheet.locator('[id="os-ubuntu-22.04-note"]')
  await expect(note).toContainText("tidak tersedia")
  await expect(sheet.locator('[id="os-ubuntu-22.04"]')).toHaveAttribute("aria-checked", "false")
  await expect(note).toHaveCSS("color", HEX.muted)
  expect(await note.evaluate((e) => getComputedStyle(e).color)).not.toBe(HEX.failed)
  await page.screenshot({ path: SHOTS(5, "ac-5.31-os-unavailable-muted") })
  await sheet.getByRole("button", { name: "Batal", exact: true }).click()
  await expect(sheet).toBeHidden()

  await rowByMac(page, OK1.mac).getByRole("button", { name: /^Aksi untuk/ }).click()
  const reason = page.locator('[data-slot="reboot-reason"]')
  await expect(reason).toContainText("Belum didukung")
  await waitForAnimations(page) // menu selesai fade-in sebelum opacity diukur
  const ratio = await reason.evaluate((el) => {
    const parse = (c: string) => {
      const m = /rgba?\(([^)]+)\)/.exec(c)
      if (!m) return null
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
    }
    // Opacity efektif = perkalian opacity elemen & leluhur; latar = latar opak terdekat.
    let opacity = 1
    let bg: { r: number; g: number; b: number; a: number } | null = null
    for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      opacity *= Number(cs.opacity)
      const c = parse(cs.backgroundColor)
      if (!bg && c && c.a > 0.99) bg = c
    }
    const fg = parse(getComputedStyle(el).color)!
    const a = fg.a * opacity
    const back = bg ?? { r: 255, g: 255, b: 255, a: 1 }
    const blend = { r: fg.r * a + back.r * (1 - a), g: fg.g * a + back.g * (1 - a), b: fg.b * a + back.b * (1 - a) }
    const lum = (c: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const l1 = lum(blend)
    const l2 = lum(back)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  })
  expect(ratio).toBeGreaterThanOrEqual(4.5)
  await page.screenshot({ path: SHOTS(5, "ac-5.31-reboot-reason") })
})
