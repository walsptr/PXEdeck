// Design-reviewer M7 iter1 — server :3196 TANPA PXE_VLAN_NETWORKS (empty state).
import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { auditA11y } from "../../../../dashboard/e2e/support/axe"
import { waitForLocatorAnimations } from "../../../../dashboard/e2e/helpers"
import { probe } from "./probe"
import { login, settle } from "./util"

const OUT = __dirname
const SH = (n: string) => path.join(OUT, "shots", `${n}.png`)
const WIDTHS = [375, 414, 768, 1024, 1280, 1440]
const results: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(path.join(OUT, "results-novlan.json"), JSON.stringify(results, null, 1)))

test("settings empty state + sheet tanpa VLAN terdaftar", async ({ page }) => {
  await login(page)
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/settings"); await settle(page)
    const empty = page.getByTestId("settings-vlan-empty")
    await expect(empty).toBeVisible()
    const e = await empty.evaluate((el) => { const cs = getComputedStyle(el); const code = el.querySelector(".type-data")!; return { text: el.textContent, color: cs.color, fs: cs.fontSize, codeFont: getComputedStyle(code).fontFamily.slice(0, 18), codeColor: getComputedStyle(code).color, tables: el.closest("[data-testid=settings-vlan]")!.querySelectorAll("table").length } })
    results[`settings-${w}`] = { empty: e, probe: await probe(page) }
    if ([375, 1440].includes(w)) {
      await page.getByTestId("settings-vlan").screenshot({ path: SH(`novlan-settings-card-${w}`) })
      await page.screenshot({ path: SH(`novlan-settings-${w}`), fullPage: true })
      const a = await auditA11y(page, `dr novlan settings@${w}`)
      results[`settings-axe-${w}`] = { violations: a.violations, filtered: a.filtered.length }
    }
  }
  for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts"); await settle(page)
    await page.getByRole("button", { name: "Aksi untuk storage-01" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi storage-01" })
    await waitForLocatorAnimations(sheet)
    await sheet.getByRole("tab", { name: /^Network/ }).click()
    await sheet.locator("#net-vlan").fill("20"); await page.waitForTimeout(250)
    await sheet.locator("#net-vlan").scrollIntoViewIfNeeded()
    const u = await sheet.evaluate((el) => ({ registered: el.querySelectorAll("[data-testid=vlan-registered]").length, unreg: (() => { const n = el.querySelector("[data-testid=vlan-unregistered]") as HTMLElement | null; return n ? `${n.innerText} | ${getComputedStyle(n).color}` : null })() }))
    results[`sheet-${w}`] = { u, probe: await probe(page) }
    await page.screenshot({ path: SH(`novlan-sheet-vlan20-${w}`) })
    const a = await auditA11y(page, `dr novlan sheet@${w}`, { include: '[data-slot="sheet-content"]' })
    results[`sheet-axe-${w}`] = { violations: a.violations, filtered: a.filtered.length }
    await page.keyboard.press("Escape")
  }
})
