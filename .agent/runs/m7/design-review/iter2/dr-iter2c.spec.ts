// Iter2 lanjutan 2: axe per elemen (region preview dan tiap deskripsi) saat elemen di tengah viewport,
// mouse dipindah ke pojok (hindari hover baris), + daftar oklusi titik tengah tiap target pelanggaran.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { auditA11y } from "../../../../../dashboard/e2e/support/axe"
import { waitForLocatorAnimations } from "../../../../../dashboard/e2e/helpers"
import { login, settle } from "../util"

const res: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(path.join(__dirname, "results-iter2-perelement.json"), JSON.stringify(res, null, 1)))
const BULK = ["b0:83:fe:5c:19:e2", "b0:83:fe:5c:19:e3", "a0:36:9f:0b:72:5d"]
test("per-element", async ({ page }) => {
  await login(page)
  for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts"); await settle(page)
    for (const m of BULK) await page.getByRole("checkbox", { name: `Pilih ${m}` }).click()
    await page.getByRole("toolbar", { name: "Aksi untuk host terpilih" }).getByRole("button", { name: "Set IP" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" }); await waitForLocatorAnimations(sheet)
    await sheet.locator("#net-vlan").fill("20"); await sheet.locator("#net-start").fill("10.99.20.41"); await sheet.locator("#net-end").fill("10.99.20.60"); await page.waitForTimeout(300)
    await page.mouse.move(0, 0)
    const out: Record<string, unknown> = {}
    const targets = ['[role=region][aria-label="Area gulir preview IP baru"]', ...Array.from({ length: await sheet.locator("[data-slot=field-description]").count() }, (_, i) => `[data-slot="sheet-content"] [data-slot=field-description] >> nth=${i}`)]
    for (const t of targets) {
      const loc = page.locator(t)
      if (!(await loc.isVisible())) continue
      await loc.evaluate((e) => { e.setAttribute("data-dr-target", "1"); e.scrollIntoView({ block: "center" }) }); await page.waitForTimeout(200)
      const covered = await loc.evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)[0]; return !!top && top !== el && !el.contains(top) ? `${top.tagName}.${top.className.toString().slice(0, 40)}` : null })
      const a = await auditA11y(page, `iter2c ${t}@${w}`, { include: "[data-dr-target]" })
      out[`${(await loc.innerText()).slice(0, 40).replace(/\s+/g, " ")}`] = { covered, violations: a.violations.map((v) => ({ id: v.id, detail: v.detail })), filtered: a.filtered.length }
      await loc.evaluate((e) => e.removeAttribute("data-dr-target"))
    }
    res[`bulk@${w}`] = out
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0)
  }
})
