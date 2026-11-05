// AC-2.9: update otomatis. Server kedua (port 3101, lihat playwright.config.ts): simulasi aktif,
// discovery tiap 2 dtk; store dibuat pada request /api/hosts pertama di test ini.
import { expect, test } from "@playwright/test"

import { hostRows, SHOTS } from "./helpers"

test.use({ baseURL: "http://localhost:3101" })

test("AC-2.9 host baru discovery muncul ≤ 6 dtk tanpa reload; polling ~5 dtk", async ({ page }) => {
  const times: number[] = []
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/hosts" && r.method() === "GET") times.push(Date.now())
  })

  await page.goto("/hosts")
  await expect(hostRows(page).first().locator("[data-status]")).toBeVisible()
  const t0 = times[0]
  // Penanda dokumen: hilang bila halaman di-reload.
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))
  const initial = await hostRows(page).count()
  expect(initial).toBe(14)

  await expect(page.getByText("f8:bc:12:3a:00:61", { exact: true })).toBeVisible({ timeout: 6_000 })
  expect(Date.now() - t0).toBeLessThanOrEqual(6_500)
  expect(await hostRows(page).count()).toBeGreaterThan(initial)
  const fresh = hostRows(page).filter({ hasText: "f8:bc:12:3a:00:61" })
  await expect(fresh.locator("[data-status]")).toHaveAttribute("data-status", "discovered")
  await page.screenshot({ path: SHOTS(2, "ac-2.9-discovered") })

  await expect.poll(() => times.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4)
  const gaps = times.slice(1, 4).map((t, i) => t - times[i])
  for (const g of gaps) {
    expect(g).toBeGreaterThan(4_000)
    expect(g).toBeLessThan(6_500)
  }
  // Tanpa reload: dokumen yang sama sepanjang test.
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
})
