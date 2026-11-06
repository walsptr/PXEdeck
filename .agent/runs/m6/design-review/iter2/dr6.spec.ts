// DR-6-6: ukur sisa scroll tabel Hosts dengan hostname 63 karakter vs tanpa — read-only.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
const OUT = __dirname
async function login(page: Page) {
  const r = await page.request.post("/api/auth/login", { headers: { "content-type": "application/json" }, data: { username: "admin-dr", password: process.env.DR_PASS } })
  expect(r.status()).toBe(204)
}
test("hostname long vs short", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of [1024, 1279, 1280, 1440, 1600, 1920]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts"); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400)
    const m = () => page.evaluate(() => {
      const table = document.querySelector("table")!; const sc = table.parentElement!
      const long = [...document.querySelectorAll("[data-testid=host-hostname]")].find((e) => (e as HTMLElement).title.length > 40) as HTMLElement | undefined
      const cols = Object.fromEntries([...table.querySelectorAll("thead th")].map((th) => [(th as HTMLElement).innerText.trim() || "sel", Math.round(th.getBoundingClientRect().width)]))
      return { overflowPx: sc.scrollWidth - sc.clientWidth, clientW: sc.clientWidth, longCell: long ? { w: Math.round(long.getBoundingClientRect().width), truncated: long.scrollWidth > long.clientWidth, title: long.title.length, text: long.textContent!.length, font: getComputedStyle(long).fontFamily.slice(0, 15) } : null, cols }
    })
    const withLong = await m()
    if (w === 1440) {
      await page.locator("[data-testid=host-hostname][title^='node-rack07']").scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(OUT, "shots", "hosts-long-hostname-1440.png") })
    }
    await page.evaluate(() => { for (const e of document.querySelectorAll("[data-testid=host-hostname]")) if ((e as HTMLElement).title.length > 40) e.textContent = "node-01" })
    await page.waitForTimeout(200)
    out[w] = { withLong, allShort: await m() }
  }
  writeFileSync(path.join(OUT, "hostname-scroll.json"), JSON.stringify(out, null, 1))
})
