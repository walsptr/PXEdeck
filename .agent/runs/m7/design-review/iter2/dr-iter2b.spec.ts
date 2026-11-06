// Iter2 lanjutan: axe tanpa artefak oklusi (bulk 375) dan dialog password dibatasi ke dialog (+ region di-scroll).
import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { auditA11y } from "../../../../../dashboard/e2e/support/axe"
import { waitForLocatorAnimations, waitForAnimations } from "../../../../../dashboard/e2e/helpers"
import { login, settle } from "../util"

const OUT = __dirname
const res: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(path.join(OUT, "results-iter2-unoccluded.json"), JSON.stringify(res, null, 1)))
const BULK = ["b0:83:fe:5c:19:e2", "b0:83:fe:5c:19:e3", "a0:36:9f:0b:72:5d"]
const ax = (a: Awaited<ReturnType<typeof auditA11y>>) => ({ violations: a.violations, filtered: a.filtered.length })
async function selectBulk(page: Page) {
  await page.goto("/hosts"); await settle(page)
  for (const m of BULK) await page.getByRole("checkbox", { name: `Pilih ${m}` }).click()
  return page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
}
test("unoccluded", async ({ page }) => {
  await login(page)
  for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    const bar = await selectBulk(page)
    await bar.getByRole("button", { name: "Set IP" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" }); await waitForLocatorAnimations(sheet)
    await sheet.locator("#net-vlan").fill("20"); await sheet.locator("#net-start").fill("10.99.20.41"); await sheet.locator("#net-end").fill("10.99.20.60"); await page.waitForTimeout(300)
    const descs = sheet.locator("[data-slot=field-description]")
    const n = await descs.count(); const per: unknown[] = []
    for (let i = 0; i < n; i++) {
      const d = descs.nth(i); if (!(await d.isVisible())) continue
      await d.evaluate((e) => e.scrollIntoView({ block: "center" })); await page.waitForTimeout(150)
      per.push({ text: (await d.innerText()).slice(0, 60), ...ax(await auditA11y(page, `iter2b bulk desc${i}@${w}`, { include: '[data-slot="sheet-content"]' })) })
    }
    const region = sheet.getByRole("region", { name: "Area gulir preview IP baru", exact: true })
    await region.evaluate((e) => e.scrollIntoView({ block: "center" })); await page.waitForTimeout(150)
    res[`bulk@${w}`] = { perDescription: per, regionCentered: ax(await auditA11y(page, `iter2b bulk region@${w}`, { include: '[data-slot="sheet-content"]' })) }
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0)

    const bar2 = await selectBulk(page)
    await bar2.getByRole("button", { name: "Set Credentials" }).click()
    const s2 = page.getByRole("dialog", { name: "Konfigurasi 3 host" }); await waitForLocatorAnimations(s2)
    await s2.getByRole("radio", { name: "Password acak per host" }).click()
    await s2.locator("#cred-user").fill(`opsdri2b${w}`)
    await s2.getByRole("button", { name: "Simpan konfigurasi" }).click()
    const dlg = page.getByRole("dialog", { name: "Password acak dibuat" }); await expect(dlg).toBeVisible(); await waitForAnimations(page)
    const pr = dlg.getByRole("region", { name: "Area gulir password yang dibuat", exact: true })
    const inc = { include: '[role="dialog"][aria-labelledby]' }
    const a0 = ax(await auditA11y(page, `iter2b pw@${w}`, inc))
    await pr.evaluate((e) => { e.scrollLeft = e.scrollWidth }); await page.waitForTimeout(150)
    const a1 = ax(await auditA11y(page, `iter2b pw scrolled@${w}`, inc))
    res[`pw@${w}`] = { dialogOnly: a0, dialogOnlyScrolledRight: a1, overflowX: await pr.evaluate((e) => e.scrollWidth - e.clientWidth) }
    await dlg.getByRole("checkbox", { name: "Saya sudah menyimpan password" }).click()
    await dlg.getByRole("button", { name: "Selesai" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  }
})
