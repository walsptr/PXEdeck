// AC-2.9 (update otomatis) + AC-4.12 (host baru muncul tanpa refresh ≤ 10 dtk). Server kedua
// (port 3101, DB demo sendiri, lihat playwright.config.ts). M4: simulasi discovery mock sudah dihapus
// dari jalur produksi (plan §1.1); discovery nyata = request iPXE `GET /boot/{mac}.ipxe` yang
// dikirim test di tengah halaman terbuka. Batas AC-2.9 (≤ 6 dtk) lebih ketat dari AC-4.12 (≤ 10 dtk).
import { expect, test } from "@playwright/test"

import { hostRows, SHOTS } from "./helpers"

test.use({ baseURL: "http://localhost:3101" })

const NEW_MAC = "f8:bc:12:3a:00:61"

test("AC-2.9/AC-4.12 host baru dari /boot/{mac}.ipxe muncul ≤ 6 dtk tanpa reload; polling ~5 dtk", async ({ page }) => {
  const times: number[] = []
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/hosts" && r.method() === "GET") times.push(Date.now())
  })

  await page.goto("/hosts")
  await expect(hostRows(page).first().locator("[data-status]")).toBeVisible()
  // Penanda dokumen: hilang bila halaman di-reload.
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))
  const initial = await hostRows(page).count()
  expect(initial).toBe(14)
  await expect(page.getByText(NEW_MAC, { exact: true })).toHaveCount(0)

  // Firmware iPXE meminta script per-MAC (format dash + huruf besar, seperti ${mac} di sebagian ROM).
  const t0 = Date.now()
  const boot = await page.request.get(`/boot/${NEW_MAC.replaceAll(":", "-").toUpperCase()}.ipxe?platform=efi`)
  expect(boot.status()).toBe(200)
  expect(boot.headers()["content-type"]).toBe("text/plain; charset=utf-8")
  expect(await boot.text()).toMatch(/^#!ipxe\n/)

  await expect(page.getByText(NEW_MAC, { exact: true })).toBeVisible({ timeout: 6_000 })
  // CR-2-7: batas sama persis dengan teks AC-2.9 (≤ 6 dtk sejak host ditemukan server).
  expect(Date.now() - t0).toBeLessThanOrEqual(6_000)
  expect(await hostRows(page).count()).toBe(initial + 1)
  const fresh = hostRows(page).filter({ hasText: NEW_MAC })
  await expect(fresh.locator("[data-status]")).toHaveAttribute("data-status", "discovered")
  expect(await (await page.request.get("/api/hosts/f8bc123a0061")).json()).toMatchObject({ status: "discovered", firmware: "uefi", vendor: expect.any(String) })
  await page.screenshot({ path: SHOTS(2, "ac-2.9-discovered") })

  await expect.poll(() => times.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4)
  const gaps = times.slice(1, 4).map((t, i) => t - times[i])
  for (const g of gaps) {
    expect(g).toBeGreaterThan(4_000)
    expect(g).toBeLessThanOrEqual(6_000)
  }
  // Request kedua untuk MAC yang sama tidak menduplikasi baris.
  await page.request.get(`/boot/${NEW_MAC}.ipxe?platform=efi`)
  await expect.poll(() => times.length, { timeout: 8_000 }).toBeGreaterThanOrEqual(5)
  await expect(page.getByText(NEW_MAC, { exact: true })).toHaveCount(1)
  // Tanpa reload: dokumen yang sama sepanjang test.
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
})
