// Investigasi temuan axe Sheet OS (compute-03) — read-only.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
const OUT = __dirname
async function login(page: Page) {
  const r = await page.request.post("/api/auth/login", { headers: { "content-type": "application/json" }, data: { username: "admin-dr", password: process.env.DR_PASS } })
  expect(r.status()).toBe(204)
}
test("sheet OS field-description muted", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const host of ["compute-03", "node-rack07", "compute-01"]) for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts"); await page.waitForLoadState("networkidle"); await page.waitForTimeout(300)
    await page.getByRole("button", { name: new RegExp(`^Aksi untuk.*${host}`) }).first().click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    await expect(page.getByRole("dialog")).toBeVisible(); await page.waitForTimeout(400)
    await page.getByRole("tab", { name: "OS", exact: true }).click(); await page.waitForTimeout(400)
    await page.mouse.move(1, 1); await page.waitForTimeout(300)
    out[`${host}@${w}`] = await page.evaluate(() => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1
      const cx = cv.getContext("2d", { willReadFrequently: true })!
      const hex = (c: string) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = [...cx.getImageData(0, 0, 1, 1).data]; return "#" + d.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("") + (d[3] < 255 ? "@" + d[3] : "") }
      const bgOf = (e: Element | null) => { while (e) { const b = getComputedStyle(e).backgroundColor; if (b !== "rgba(0, 0, 0, 0)") return `${hex(b)} <${e.tagName.toLowerCase()} ${(e as HTMLElement).dataset.slot ?? ""} ${e.className.toString().slice(0, 60)}>`; e = e.parentElement } return "none" }
      return [...document.querySelectorAll('[data-slot="sheet-content"] [data-slot=field-description]')].map((d) => ({ text: (d as HTMLElement).innerText.slice(0, 70), color: hex(getComputedStyle(d).color), cls: d.className.toString().slice(0, 140), bg: bgOf(d), fieldOrientation: d.parentElement?.getAttribute("data-orientation"), parentCls: d.parentElement?.className.toString().slice(0, 80) }))
    })
    if (host === "compute-03" && w === 1440) await page.getByRole("dialog").screenshot({ path: path.join(OUT, "shots", "sheet-os-compute03-1440.png") })
    await page.keyboard.press("Escape"); await page.waitForTimeout(300)
  }
  writeFileSync(path.join(OUT, "sheet-os-probe.json"), JSON.stringify(out, null, 1))
})
