// Investigasi: axe Sheet dengan petunjuk VLAN di tengah viewport (bukan di bawah footer sticky), ringkasan
// error "Perlu diperbaiki" (mono), dialog password dengan region di-scroll horizontal. Read-only.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { auditA11y } from "../../../../dashboard/e2e/support/axe"
import { waitForLocatorAnimations, waitForAnimations } from "../../../../dashboard/e2e/helpers"
import { login, settle } from "./util"

const OUT = __dirname
const SH = (n: string) => path.join(OUT, "shots", `${n}.png`)
const res: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(path.join(OUT, "results-vlan-unoccluded.json"), JSON.stringify(res, null, 1)))
const STATES = [
  { key: "vlan20-valid", vlan: "20", ip: "10.99.20.41" },
  { key: "vlan20-outside", vlan: "20", ip: "10.99.10.41" },
  { key: "vlan30-auto", vlan: "30", ip: "10.99.30.5" },
  { key: "vlan99-unregistered", vlan: "99", ip: "10.10.10.41" },
  { key: "vlan99-outside", vlan: "99", ip: "10.99.20.41" },
]
test("sheet unoccluded axe + ringkasan error", async ({ page }) => {
  await login(page)
  for (const w of [375, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts"); await settle(page)
    await page.getByRole("button", { name: "Aksi untuk storage-01" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi storage-01" })
    await waitForLocatorAnimations(sheet)
    await sheet.getByRole("tab", { name: /^Network/ }).click()
    for (const s of STATES) {
      await sheet.locator("#net-vlan").fill(s.vlan); await sheet.locator("#net-ip").fill(s.ip); await page.waitForTimeout(250)
      const regions: Record<string, unknown> = {}
      for (const sel of ["[data-testid=vlan-registered]", "[data-testid=net-ip-hint]", "[data-slot=field-error]", "[data-testid=vlan-unregistered]"]) {
        const loc = sheet.locator(sel).first()
        if (!(await loc.count())) continue
        await loc.evaluate((e) => e.scrollIntoView({ block: "center" })); await page.waitForTimeout(150)
        const a = await auditA11y(page, `dr2 ${s.key} ${sel}@${w}`, { include: '[data-slot="sheet-content"]' })
        regions[sel] = { violations: a.violations, filtered: a.filtered.length }
      }
      // ringkasan error di atas tab
      const sum = sheet.getByRole("tabpanel").getByRole("alert").first()
      let summary: unknown = null
      if (await sum.count()) {
        await sum.evaluate((e) => e.scrollIntoView({ block: "center" })); await page.waitForTimeout(150)
        summary = await sum.evaluate((el) => [...el.querySelectorAll("li")].map((li) => ({ text: li.textContent, font: getComputedStyle(li).fontFamily.slice(0, 16), monoChildren: li.querySelectorAll("[data-slot=ip-token],.type-data").length })))
        if (w !== 768) await sum.screenshot({ path: SH(`sheet-summary-${s.key}-${w}`) })
      }
      res[`${s.key}@${w}`] = { regions, summary }
    }
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0)
  }
  // dialog password 375: region di-scroll ke kanan agar kolom 3 terlihat
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto("/hosts"); await settle(page)
  for (const m of ["b0:83:fe:5c:19:e2", "b0:83:fe:5c:19:e3", "a0:36:9f:0b:72:5d"]) await page.getByRole("checkbox", { name: `Pilih ${m}` }).click()
  await page.getByRole("toolbar", { name: "Aksi untuk host terpilih" }).getByRole("button", { name: "Set Credentials" }).click()
  const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" }); await waitForLocatorAnimations(sheet)
  await sheet.getByRole("radio", { name: "Password acak per host" }).click()
  await sheet.locator("#cred-user").fill("opsdr2")
  await sheet.getByRole("button", { name: "Simpan konfigurasi" }).click()
  const dlg = page.getByRole("dialog", { name: "Password acak dibuat" }); await expect(dlg).toBeVisible(); await waitForAnimations(page)
  const region = dlg.getByRole("region", { name: "Password yang dibuat" })
  await region.evaluate((e) => { e.scrollLeft = e.scrollWidth })
  await page.waitForTimeout(150)
  const a = await auditA11y(page, "dr2 pwdialog scrolled@375")
  res["pwdialog-scrolled@375"] = { violations: a.violations, filtered: a.filtered.length }
  const warn = await dlg.locator("[data-slot=alert]").first().evaluate((el) => ({ text: (el as HTMLElement).innerText, title: getComputedStyle(el.querySelector("[data-slot=alert-title]") ?? el).color, desc: getComputedStyle(el.querySelector("[data-slot=alert-description]") ?? el).color })).catch(() => null)
  res["pwdialog-alert"] = warn
  await page.screenshot({ path: SH("passwords-dialog-375"), mask: [region.locator("tbody td:nth-child(3)")] })
})
