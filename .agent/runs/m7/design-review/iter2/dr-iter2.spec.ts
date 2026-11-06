// Design-reviewer M7 iter2 (sempit): login (CR-7-3), region scroll plan-table & dialog password (CR-7-4),
// token objektif halaman utama. Read-only terhadap kode; DB sementara.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page, type Locator } from "@playwright/test"
import { auditA11y } from "../../../../../dashboard/e2e/support/axe"
import { waitForLocatorAnimations, waitForAnimations } from "../../../../../dashboard/e2e/helpers"
import { probe } from "../probe"
import { focusInfo, login, settle, tabTo } from "../util"

const OUT = __dirname
const SH = (n: string) => path.join(OUT, "shots", `${n}.png`)
const results: Record<string, unknown> = {}
test.describe.configure({ mode: "serial" })
test.afterAll(() => writeFileSync(path.join(OUT, "results-iter2.json"), JSON.stringify(results, null, 1)))
const BULK = ["b0:83:fe:5c:19:e2", "b0:83:fe:5c:19:e3", "a0:36:9f:0b:72:5d"]
const axeOut = (a: Awaited<ReturnType<typeof auditA11y>>) => ({ label: a.label, violations: a.violations, filtered: a.filtered.length, filteredCats: a.filtered.reduce<Record<string, number>>((m, f) => ({ ...m, [f.category]: (m[f.category] ?? 0) + 1 }), {}) })

/** Pohon aksesibilitas Chromium (CDP): role+nama region/table di dalam root. */
async function axNames(page: Page, root: Locator) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("DOM.getDocument", { depth: -1 })
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: { role?: { value: string }; name?: { value: string }; ignored?: boolean; backendDOMNodeId?: number }[] }
  const out = nodes.filter((n) => !n.ignored && ["region", "table", "dialog"].includes(n.role?.value ?? "")).map((n) => `${n.role!.value}: "${n.name?.value ?? ""}"`)
  await cdp.detach()
  return { ax: out, aria: await root.ariaSnapshot().then((s) => s.split("\n").filter((l) => /region|table "|dialog/.test(l)).slice(0, 8)) }
}

test("login: muat normal + hidrasi tertunda + tanpa JS", async ({ page, browser }) => {
  const out: Record<string, unknown> = {}
  const recorder = () => {
    const samples: { op: string; dis: boolean; bg: string; hyd: boolean }[] = []
    ;(window as unknown as { __s: typeof samples }).__s = samples
    const tick = () => {
      const b = document.querySelector("[data-testid=login-submit]") as HTMLButtonElement | null
      if (b) { const cs = getComputedStyle(b); samples.push({ op: cs.opacity, dis: b.disabled, bg: cs.backgroundColor, hyd: !!b.closest("form")?.hasAttribute("data-hydrated") }) }
      if (samples.length < 4000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    document.addEventListener("readystatechange", tick)
  }
  for (const w of [375, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: "id-ID" })
    const p = await ctx.newPage()
    await p.addInitScript(recorder)
    await p.goto("/login")
    await expect(p.locator("form[data-hydrated]")).toBeAttached()
    await settle(p)
    const s = await p.evaluate(() => (window as unknown as { __s: { op: string; dis: boolean; hyd: boolean; bg: string }[] }).__s)
    const btn = await p.getByTestId("login-submit").evaluate((el) => { const cs = getComputedStyle(el); return { disabled: (el as HTMLButtonElement).disabled, opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color, h: el.getBoundingClientRect().height } })
    out[w] = { btn, samplesN: s.length, preHydrationN: s.filter((x) => !x.hyd).length, minOpacity: Math.min(...s.map((x) => Number(x.op))), bgs: [...new Set(s.map((x) => x.bg))], probe: await probe(p), method: await p.locator("form").getAttribute("method"), action: await p.locator("form").getAttribute("action"), axe: axeOut(await auditA11y(p, `iter2 login@${w}`)) }
    await p.screenshot({ path: SH(`login-normal-${w}`), fullPage: true })
    await ctx.close()
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "id-ID" })
    const p = await ctx.newPage()
    await p.addInitScript(recorder)
    await p.route(/\.js(\?|$)/, async (r) => { await new Promise((res) => setTimeout(res, 2500)); await r.continue() })
    await p.goto("/login", { waitUntil: "commit" })
    await p.waitForSelector("[data-testid=login-submit]"); await p.waitForTimeout(600)
    const pre = await p.getByTestId("login-submit").evaluate((el) => { const cs = getComputedStyle(el); return { disabled: (el as HTMLButtonElement).disabled, opacity: cs.opacity, bg: cs.backgroundColor, hydrated: !!el.closest("form")?.hasAttribute("data-hydrated") } })
    await p.screenshot({ path: SH("login-slow-prehydration-1440") })
    await expect(p.locator("form[data-hydrated]")).toBeAttached({ timeout: 30_000 }); await p.waitForTimeout(500)
    const post = await p.getByTestId("login-submit").evaluate((el) => { const cs = getComputedStyle(el); return { disabled: (el as HTMLButtonElement).disabled, opacity: cs.opacity, bg: cs.backgroundColor } })
    const s = await p.evaluate(() => (window as unknown as { __s: { op: string; bg: string }[] }).__s)
    out["slow"] = { pre, post, samplesN: s.length, opacities: [...new Set(s.map((x) => x.op))], bgs: [...new Set(s.map((x) => x.bg))] }
    await ctx.close()
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, locale: "id-ID", javaScriptEnabled: false })
    const p = await ctx.newPage()
    await p.goto("/login")
    out["nojs"] = await p.getByTestId("login-submit").evaluate((el) => { const cs = getComputedStyle(el); return { disabled: (el as HTMLButtonElement).disabled, opacity: cs.opacity, bg: cs.backgroundColor } })
    await p.screenshot({ path: SH("login-nojs-375"), fullPage: true })
    await ctx.close()
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/login"); await expect(page.locator("form[data-hydrated]")).toBeAttached(); await settle(page)
  const seq = [await focusInfo(page)]
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Tab"); seq.push(await focusInfo(page)) }
  await page.screenshot({ path: SH("login-kbd-submit-focus-1440") })
  out["kbd"] = seq.map((f) => ({ el: f.el, fv: f.fv, border: f.border, rings: f.rings }))
  results["login"] = out
})

for (const pth of ["/hosts", "/settings", "/jobs", "/os-images", "/ssh-keys"]) {
  test(`halaman ${pth}`, async ({ page }) => {
    await login(page)
    const rows: Record<string, unknown> = {}
    for (const w of [375, 1440]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto(pth); await settle(page)
      rows[w] = await probe(page)
      rows[`axe-${w}`] = axeOut(await auditA11y(page, `iter2 ${pth}@${w}`))
      await page.screenshot({ path: SH(`page${pth.replace(/\//g, "_")}-${w}`), fullPage: true })
    }
    results[pth] = rows
  })
}

async function selectBulk(page: Page) {
  await page.goto("/hosts"); await settle(page)
  for (const m of BULK) await page.getByRole("checkbox", { name: `Pilih ${m}` }).click()
  return page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
}

test("Bulk VLAN 20: region preview IP baru (CR-7-4)", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    const bar = await selectBulk(page)
    await bar.getByRole("button", { name: "Set IP" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
    await waitForLocatorAnimations(sheet)
    await sheet.locator("#net-vlan").fill("20")
    await sheet.locator("#net-start").fill("10.99.20.41")
    await sheet.locator("#net-end").fill("10.99.20.60")
    await page.waitForTimeout(300)
    const region = sheet.getByRole("region", { name: "Area gulir preview IP baru", exact: true })
    const table = sheet.getByRole("table", { name: "Preview IP baru", exact: true })
    await expect(region).toBeVisible(); await expect(table).toBeVisible()
    const oldName = await sheet.getByRole("region", { name: "Preview IP baru", exact: true }).count()
    await sheet.locator("#net-vlan").focus()
    let steps = await tabTo(page, '[role=region][aria-label="Area gulir preview IP baru"]', 30)
    if (steps < 0) { await sheet.locator("#net-start").focus(); for (let i = 0; i < 30 && !(await region.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Shift+Tab"); steps = (await region.evaluate((e) => e === document.activeElement)) ? 99 : -1 }
    const f = await focusInfo(page)
    await region.screenshot({ path: SH(`focus-plan-region-${w}`) }).catch(() => {})
    await page.screenshot({ path: SH(`bulk-vlan20-preview-focus-${w}`) })
    const sl0 = await region.evaluate((e) => [e.scrollLeft, e.scrollTop])
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown"); await page.waitForTimeout(150)
    const sl1 = await region.evaluate((e) => [e.scrollLeft, e.scrollTop])
    out[w] = { steps, focus: f, oldNameRegionCount: oldName, names: await axNames(page, sheet), scrollBefore: sl0, scrollAfterArrows: sl1, probe: await probe(page), axe: axeOut(await auditA11y(page, `iter2 bulk vlan20@${w}`, { include: '[data-slot="sheet-content"]' })) }
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0)
  }
  results["bulk-plan"] = out
})

test("Dialog password acak: region vs tabel (CR-7-4)", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    const bar = await selectBulk(page)
    await bar.getByRole("button", { name: "Set Credentials" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
    await waitForLocatorAnimations(sheet)
    await sheet.getByRole("radio", { name: "Password acak per host" }).click()
    await sheet.locator("#cred-user").fill(`opsdri2${w}`)
    await sheet.getByRole("button", { name: "Simpan konfigurasi" }).focus()
    await page.keyboard.press("Enter")
    const dlg = page.getByRole("dialog", { name: "Password acak dibuat" })
    await expect(dlg).toBeVisible(); await waitForAnimations(page)
    const region = dlg.getByRole("region", { name: "Area gulir password yang dibuat", exact: true })
    const table = dlg.getByRole("table", { name: "Password yang dibuat", exact: true })
    await expect(region).toBeVisible(); await expect(table).toBeVisible()
    const initial = await focusInfo(page)
    let s2 = -1
    for (let i = 0; i < 15; i++) { if (await region.evaluate((e) => e === document.activeElement)) { s2 = i; break } await page.keyboard.press("Tab") }
    const f = await focusInfo(page)
    const mask = [region.locator("tbody td:nth-child(3)")]
    await page.screenshot({ path: SH(`focus-passwords-dialog-${w}`), mask })
    await region.screenshot({ path: SH(`focus-passwords-region-${w}`), mask }).catch(() => {})
    out[w] = { initialFocus: initial.el, stepsToRegion: s2, focus: f, oldNameRegionCount: await dlg.getByRole("region", { name: "Password yang dibuat", exact: true }).count(), names: await axNames(page, dlg), probe: await probe(page), axe: axeOut(await auditA11y(page, `iter2 pwdialog@${w}`)) }
    await dlg.getByRole("checkbox", { name: "Saya sudah menyimpan password" }).click()
    await dlg.getByRole("button", { name: "Selesai" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  }
  results["pw-dialog"] = out
})
