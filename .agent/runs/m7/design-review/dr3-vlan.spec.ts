// Investigasi DR-7-1: ringkasan error "Perlu diperbaiki" di tab Network — font CIDR. Read-only.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { test } from "@playwright/test"
import { waitForLocatorAnimations } from "../../../../dashboard/e2e/helpers"
import { login, settle } from "./util"
const OUT = __dirname
test("ringkasan error VLAN", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts"); await settle(page)
    await page.getByRole("button", { name: "Aksi untuk storage-01" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi storage-01" })
    await waitForLocatorAnimations(sheet)
    await sheet.getByRole("tab", { name: /^Network/ }).click()
    await sheet.locator("#net-vlan").fill("20"); await sheet.locator("#net-ip").fill("10.99.10.41"); await page.waitForTimeout(300)
    const sum = sheet.locator("[data-slot=alert]").filter({ hasText: "Perlu diperbaiki" }).first()
    await sum.evaluate((e) => e.scrollIntoView({ block: "center" })); await page.waitForTimeout(200)
    out[w] = await sum.evaluate((el) => ({ where: el.closest("[role=tabpanel]") ? "tabpanel" : el.parentElement?.className.slice(0, 60), li: [...el.querySelectorAll("li")].map((li) => ({ text: li.textContent, font: getComputedStyle(li).fontFamily.slice(0, 16), color: getComputedStyle(li).color, mono: li.querySelectorAll("[data-slot=ip-token]").length })) }))
    await page.screenshot({ path: path.join(OUT, "shots", `sheet-summary-vlan20-outside-${w}.png`) })
    await page.keyboard.press("Escape")
  }
  writeFileSync(path.join(OUT, "summary-font.json"), JSON.stringify(out, null, 1))
})
