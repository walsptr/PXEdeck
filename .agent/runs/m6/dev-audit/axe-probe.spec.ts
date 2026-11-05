import path from "node:path"
import { writeFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

const AXE = path.resolve(__dirname, "../../node_modules/axe-core/axe.min.js")
type V = { id: string; impact: string; help: string; nodes: { target: string[]; failureSummary: string; any: { data?: { fgColor?: string; bgColor?: string; contrastRatio?: number } }[] }[] }

async function axe(page: Page) {
  await page.addScriptTag({ path: AXE })
  return page.evaluate(async () => {
    // @ts-expect-error axe global
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })
    return r.violations as V[]
  })
}

test("probe axe", async ({ page, browser }) => {
  const out: Record<string, unknown> = {}
  const summarize = (vs: V[]) =>
    vs.map((v) => ({
      id: v.id,
      impact: v.impact,
      n: v.nodes.length,
      nodes: v.nodes.map((n) => ({ t: n.target.join(" "), c: n.any?.[0]?.data ? `${n.any[0].data.fgColor}/${n.any[0].data.bgColor} ${n.any[0].data.contrastRatio}` : n.failureSummary?.slice(0, 120) })),
    }))
  const anon = await browser.newPage()
  for (const w of [1440, 375]) {
    await anon.setViewportSize({ width: w, height: 900 })
    await anon.goto("/login")
    await anon.getByLabel("Username").waitFor()
    out[`login@${w}`] = summarize(await axe(anon))
  }
  const r = await page.request.post("/api/auth/login", { headers: { "content-type": "application/json" }, data: { username: "admin-audit", password: process.env.AUDIT_ADMIN_PASSWORD } })
  expect(r.status()).toBe(204)
  for (const w of [1440, 375]) {
    await page.setViewportSize({ width: w, height: 900 })
    for (const p of ["/hosts", "/jobs?job=job-audit-007-xxxxxxxxxxxxxxxxxxxx", "/os-images", "/ssh-keys", "/settings"]) {
      await page.goto(p)
      await page.waitForLoadState("networkidle").catch(() => {})
      await page.waitForTimeout(500)
      out[`${p}@${w}`] = summarize(await axe(page))
    }
    await page.goto("/hosts")
    await page.getByRole("button", { name: /^Aksi untuk/ }).first().click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    await page.getByRole("dialog").locator('[data-available="false"]').first().waitFor()
    out[`sheet@${w}`] = summarize(await axe(page))
    await page.keyboard.press("Escape")
  }
  writeFileSync(path.join(process.env.AUDIT_OUT!, "axe.json"), JSON.stringify(out, null, 1))
})
