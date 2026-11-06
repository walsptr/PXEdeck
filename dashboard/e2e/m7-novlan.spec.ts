// M7-T8 (AC-7.12 empty state, DEC-024/025): server bersama :3100 TANPA `PXE_VLAN_NETWORKS`. Read-only —
// Sheet dibuka dan diisi tanpa disimpan.
import { expect, test, type Page } from "@playwright/test"

import { gotoHosts, SHOTS, waitForLocatorAnimations } from "./helpers"
import { auditA11y } from "./support/axe"

const MUTED = "rgb(128, 125, 114)"

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState("networkidle").catch(() => {})
}

test("API tanpa env: kunci vlanNetworks tidak ada di /api/settings & /api/network (DEC-025 §3)", async ({ request }) => {
  const settings = await (await request.get("/api/settings")).json()
  const network = await (await request.get("/api/network")).json()
  expect(Object.keys(settings)).not.toContain("vlanNetworks")
  expect(Object.keys(network)).not.toContain("vlanNetworks")
  expect(settings.cidr).toBe("10.10.10.0/24")
})

test("/settings tanpa VLAN: card VLAN management dengan empty state; axe 0 pelanggaran; 375/768/1280/1440 tanpa overflow", async ({ page }) => {
  await page.goto("/settings")
  const card = page.getByTestId("settings-vlan")
  await expect(card).toBeVisible()
  await settle(page)
  const titles = (await page.locator('[data-slot="settings-section"] [data-slot="card-title"]').allTextContents()).map((t) => t.trim())
  expect(titles.slice(0, 2)).toEqual(["Jaringan provisioning", "VLAN management"])
  await expect(page.getByTestId("settings-vlan-empty")).toHaveText("Tidak ada VLAN management terdaftar (PXE_VLAN_NETWORKS)")
  await expect(card.getByRole("table")).toHaveCount(0)
  const mono = await page.getByTestId("settings-vlan-empty").locator("span").evaluate((el) => getComputedStyle(el).fontFamily)
  expect(mono.startsWith('"JetBrains Mono Variable"')).toBe(true)
  const kept: Record<string, unknown> = {}
  for (const w of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await waitForLocatorAnimations(card)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${w}`).toBe(w)
    const a = await auditA11y(page, `m7 /settings tanpa VLAN@${w}`)
    if (a.violations.length) kept[`${w}`] = a.violations
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: SHOTS(7, `ac-7.12-settings-empty-${w}`), fullPage: true })
  }
  expect(kept, JSON.stringify(kept, null, 1)).toEqual({})
})

test("Sheet tanpa VLAN terdaftar: tanpa daftar 'Terdaftar', VLAN 20 → petunjuk tidak terdaftar (teks utama) + subnet PXE (DEC-006)", async ({ page }) => {
  await gotoHosts(page)
  await page.getByRole("button", { name: "Aksi untuk storage-01" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: "Konfigurasi storage-01" })
  await expect(sheet).toBeVisible()
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  await expect(sheet.getByTestId("vlan-registered")).toHaveCount(0)
  await expect(sheet.getByTestId("vlan-unregistered")).toHaveCount(0)
  await sheet.locator("#net-vlan").fill("20")
  const unreg = sheet.getByTestId("vlan-unregistered")
  await expect(unreg).toHaveText("VLAN 20 tidak terdaftar di PXE_VLAN_NETWORKS; IP, prefix, dan gateway mengikuti subnet PXE 10.10.10.0/24.")
  expect(await unreg.evaluate((el) => getComputedStyle(el).color)).not.toBe(MUTED)
  await expect(sheet.locator("#net-gw")).toHaveValue("10.10.10.1")
  await expect(sheet.locator("#net-prefix")).toHaveValue("24")
  await sheet.locator("#net-ip").fill("10.99.20.41")
  await expect(sheet.locator('[data-slot="field-error"]').first()).toHaveText("Di luar subnet 10.10.10.0/24")
  await expect(sheet.getByRole("button", { name: "Simpan konfigurasi" })).toBeDisabled()
  await sheet.locator("#net-ip").fill("10.10.10.45")
  await expect(sheet.locator('[data-slot="field-error"]')).toHaveCount(0)
  await expect(sheet.getByRole("button", { name: "Simpan konfigurasi" })).toBeEnabled()
  await page.screenshot({ path: SHOTS(7, "m7-novlan-sheet-vlan20-unregistered") })
  // Tidak disimpan (server bersama read-only).
  await page.keyboard.press("Escape")
})
