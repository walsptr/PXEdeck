import path from "node:path"
import { writeFileSync } from "node:fs"
import { test, type Page } from "@playwright/test"
const OUT = __dirname
const info = (page: Page) => page.evaluate(() => { const a = document.activeElement as HTMLElement; const cs = getComputedStyle(a); return { el: `${a.tagName}#${a.id}[${a.getAttribute("aria-label") ?? a.textContent?.trim()}]`, fv: a.matches(":focus-visible"), boxShadow: cs.boxShadow, outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} off=${cs.outlineOffset}`, border: cs.borderTopColor, bg: cs.backgroundColor } })
test("fokus login per elemen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/login"); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500)
  const out: unknown[] = [await info(page)]
  await page.screenshot({ path: path.join(OUT, "shots", "focus-0-username.png"), clip: { x: 520, y: 400, width: 400, height: 280 } })
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press("Tab"); await page.waitForTimeout(200)
    out.push(await info(page))
    await page.screenshot({ path: path.join(OUT, "shots", `focus-${i}.png`), clip: { x: 520, y: 400, width: 400, height: 280 } })
  }
  writeFileSync(path.join(OUT, "focus.json"), JSON.stringify(out, null, 1))
})
