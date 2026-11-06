// Reproduksi temuan axe Sheet OS — read-only.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { auditA11y } from "../../../../../dashboard/e2e/support/axe"
const OUT = __dirname
async function login(page: Page) {
  const r = await page.request.post("/api/auth/login", { headers: { "content-type": "application/json" }, data: { username: "admin-dr", password: process.env.DR_PASS } })
  expect(r.status()).toBe(204)
}
test("axe sheet OS repro", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const variant of ["direct", "via-hostname-tab", "via-hostname-tab-mouseaway", "via-hostname-tab-wait2s"]) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/hosts"); await page.waitForLoadState("networkidle"); await page.waitForTimeout(300)
    await page.getByRole("button", { name: /^Aksi untuk.*compute-03/ }).first().click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    await expect(page.getByRole("dialog")).toBeVisible(); await page.waitForTimeout(600)
    if (variant !== "direct") { await page.getByRole("tab", { name: "Hostname", exact: true }).click(); await page.waitForTimeout(300); await page.getByRole("tab", { name: "OS", exact: true }).click(); await page.waitForTimeout(300) }
    if (variant.endsWith("mouseaway")) { await page.mouse.move(1, 1); await page.waitForTimeout(300) }
    if (variant.endsWith("2s")) await page.waitForTimeout(2000)
    const geo = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[data-slot="sheet-content"] [data-slot=field-description]')].find((x) => (x as HTMLElement).innerText.startsWith("Kosongkan")) as HTMLElement
      const r = d.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const stack = document.elementsFromPoint(cx, cy).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}[${(e as HTMLElement).dataset.slot ?? ""}] bg=${getComputedStyle(e).backgroundColor}`)
      return { rect: [Math.round(r.top), Math.round(r.bottom)], vh: innerHeight, stack }
    })
    const a = await auditA11y(page, `dr5 ${variant}`, { include: '[data-slot="sheet-content"]' })
    out[variant] = { geo, violations: a.violations }
    if (variant === "via-hostname-tab") await page.screenshot({ path: path.join(OUT, "shots", "sheet-os-axe-repro-1440.png") })
  }
  writeFileSync(path.join(OUT, "sheet-os-axe-repro.json"), JSON.stringify(out, null, 1))
})
