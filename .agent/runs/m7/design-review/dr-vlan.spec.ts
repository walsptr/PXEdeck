// Design-reviewer M7 iter1 — server :3195 dengan PXE_VLAN_NETWORKS. Read-only terhadap kode; DB sementara.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { auditA11y } from "../../../../dashboard/e2e/support/axe"
import { waitForLocatorAnimations, waitForAnimations } from "../../../../dashboard/e2e/helpers"
import { probe } from "./probe"
import { focusInfo, fonts, login, occlusion, settle, tabTo } from "./util"

const OUT = __dirname
const SH = (n: string) => path.join(OUT, "shots", `${n}.png`)
mkdirSync(path.join(OUT, "shots"), { recursive: true })
const WIDTHS = [375, 414, 768, 1024, 1280, 1440]
const results: Record<string, unknown> = {}
test.describe.configure({ mode: "serial" })
test.afterAll(() => writeFileSync(path.join(OUT, "results-vlan.json"), JSON.stringify(results, null, 1)))
const BULK = ["b0:83:fe:5c:19:e2", "b0:83:fe:5c:19:e3", "a0:36:9f:0b:72:5d"]
const axeOut = (a: Awaited<ReturnType<typeof auditA11y>>) => ({ label: a.label, violations: a.violations, filtered: a.filtered.length, filteredCats: a.filtered.reduce<Record<string, number>>((m, f) => ({ ...m, [f.category]: (m[f.category] ?? 0) + 1 }), {}) })

test("login: muat normal + hidrasi tertunda + tanpa JS + semua lebar", async ({ page, browser }) => {
  const out: Record<string, unknown> = {}
  // Rekam opacity/disabled tombol sepanjang muat (dari dokumen pertama sampai hidrasi).
  const recorder = () => {
    const samples: { t: number; op: string; dis: boolean; bg: string; hyd: boolean }[] = []
    ;(window as unknown as { __s: typeof samples }).__s = samples
    const tick = () => {
      const b = document.querySelector("[data-testid=login-submit]") as HTMLButtonElement | null
      if (b) { const cs = getComputedStyle(b); samples.push({ t: Math.round(performance.now()), op: cs.opacity, dis: b.disabled, bg: cs.backgroundColor, hyd: !!b.closest("form")?.hasAttribute("data-hydrated") }) }
      if (samples.length < 4000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    document.addEventListener("readystatechange", tick)
  }
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: "id-ID" })
    const p = await ctx.newPage()
    await p.addInitScript(recorder)
    await p.goto("/login")
    await expect(p.locator("form[data-hydrated]")).toBeAttached()
    await settle(p)
    const samples = await p.evaluate(() => (window as unknown as { __s: { op: string; dis: boolean; hyd: boolean; bg: string }[] }).__s)
    const btn = await p.getByTestId("login-submit").evaluate((el) => { const cs = getComputedStyle(el); return { disabled: (el as HTMLButtonElement).disabled, opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color, h: el.getBoundingClientRect().height, fs: cs.fontSize, fw: cs.fontWeight, radius: cs.borderTopLeftRadius, transition: cs.transitionProperty, cursor: cs.cursor } })
    out[w] = { btn, samplesN: samples.length, minOpacity: Math.min(...samples.map((s) => Number(s.op))), preHydration: samples.filter((s) => !s.hyd).slice(0, 3), firstHydrated: samples.find((s) => s.hyd), probe: await probe(p), formMethod: await p.locator("form").getAttribute("method"), formAction: await p.locator("form").getAttribute("action") }
    if ([375, 1440].includes(w)) await p.screenshot({ path: SH(`login-normal-${w}`), fullPage: true })
    await ctx.close()
  }
  // Hidrasi diperlambat 2.5 s (chunk JS ditunda) → tampilan sebelum hidrasi pada muat "lambat".
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "id-ID" })
    const p = await ctx.newPage()
    await p.addInitScript(recorder)
    await p.route(/\.js(\?|$)/, async (r) => { await new Promise((res) => setTimeout(res, 2500)); await r.continue() })
    await p.goto("/login", { waitUntil: "commit" })
    await p.waitForSelector("[data-testid=login-submit]")
    await p.waitForTimeout(600)
    const pre = await p.getByTestId("login-submit").evaluate((el) => { const cs = getComputedStyle(el); return { disabled: (el as HTMLButtonElement).disabled, opacity: cs.opacity, bg: cs.backgroundColor, cursor: cs.cursor, hydrated: !!el.closest("form")?.hasAttribute("data-hydrated") } })
    await p.screenshot({ path: SH("login-slow-prehydration-1440") })
    await expect(p.locator("form[data-hydrated]")).toBeAttached({ timeout: 30_000 })
    await p.waitForTimeout(500)
    const post = await p.getByTestId("login-submit").evaluate((el) => { const cs = getComputedStyle(el); return { disabled: (el as HTMLButtonElement).disabled, opacity: cs.opacity, bg: cs.backgroundColor } })
    const samples = await p.evaluate(() => (window as unknown as { __s: { op: string; dis: boolean; hyd: boolean; bg: string }[] }).__s)
    await p.screenshot({ path: SH("login-slow-posthydration-1440") })
    out["slow"] = { pre, post, samplesN: samples.length, opacities: [...new Set(samples.map((s) => s.op))], bgs: [...new Set(samples.map((s) => s.bg))] }
    await ctx.close()
  }
  // Tanpa JS sama sekali.
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, locale: "id-ID", javaScriptEnabled: false })
    const p = await ctx.newPage()
    await p.goto("/login")
    out["nojs"] = await p.getByTestId("login-submit").evaluate((el) => { const cs = getComputedStyle(el); return { disabled: (el as HTMLButtonElement).disabled, opacity: cs.opacity, bg: cs.backgroundColor } })
    await p.screenshot({ path: SH("login-nojs-375"), fullPage: true })
    await ctx.close()
  }
  // Keyboard: username → password → toggle → Masuk.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/login"); await expect(page.locator("form[data-hydrated]")).toBeAttached(); await settle(page)
  const seq = [await focusInfo(page)]
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Tab"); seq.push(await focusInfo(page)) }
  await page.screenshot({ path: SH("login-kbd-submit-focus-1440") })
  out["kbd"] = seq
  for (const w of [375, 1440]) { await page.setViewportSize({ width: w, height: 900 }); await page.goto("/login"); await expect(page.locator("form[data-hydrated]")).toBeAttached(); await settle(page); out[`axe-${w}`] = axeOut(await auditA11y(page, `dr login@${w}`)) }
  results["login"] = out
})

const PAGES = ["/hosts", "/settings", "/jobs", "/os-images", "/ssh-keys"]
for (const pth of PAGES) {
  test(`halaman ${pth}`, async ({ page }) => {
    await login(page)
    const rows: Record<string, unknown> = {}
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto(pth); await settle(page)
      rows[w] = await probe(page)
      if ([375, 768, 1440].includes(w)) await page.screenshot({ path: SH(`page${pth.replace(/\//g, "_")}-${w}`), fullPage: true })
      if ([375, 1440].includes(w)) rows[`axe-${w}`] = axeOut(await auditA11y(page, `dr ${pth}@${w}`))
    }
    results[pth] = rows
  })
}

test("settings: card VLAN management detail", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/settings"); await settle(page)
    const card = page.getByTestId("settings-vlan")
    await expect(card.locator("tbody tr")).toHaveCount(2)
    out[w] = await card.evaluate((el) => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
      const ths = [...el.querySelectorAll("th")].map((t) => { const c = getComputedStyle(t); return `${t.textContent} ${c.fontSize}/${c.fontWeight} ${c.textTransform} ls=${c.letterSpacing} ${c.color} ${c.fontFamily.slice(0, 10)}` })
      const tds = [...el.querySelectorAll("td")].map((t) => `${t.textContent} ${getComputedStyle(t).fontFamily.slice(0, 18)} ${getComputedStyle(t).fontSize} ${getComputedStyle(t).color}`)
      const title = el.querySelector("[data-slot=card-title]")!; const tc = getComputedStyle(title)
      const descr = el.querySelector("[data-slot=card-description]")!
      const sc = el.querySelector("[data-slot=table-container]") as HTMLElement
      return { bg: cs.backgroundColor, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, left: r.left, right: r.right, vw: innerWidth,
        title: `${title.textContent} ${tc.fontSize}/${tc.fontWeight} ${tc.color}`, desc: `${getComputedStyle(descr).fontSize} ${getComputedStyle(descr).color}`, ths, tds,
        tableScroll: sc ? sc.scrollWidth - sc.clientWidth : null, docSW: document.documentElement.scrollWidth,
        order: [...document.querySelectorAll("[data-slot=settings-section] [data-slot=card-title]")].map((t) => t.textContent) }
    })
    if ([375, 1440].includes(w)) await card.screenshot({ path: SH(`settings-vlan-card-${w}`) })
  }
  results["settings-vlan"] = out
})

async function openSingle(page: Page, name: string) {
  await page.goto("/hosts"); await settle(page)
  await page.getByRole("button", { name: `Aksi untuk ${name}` }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: `Konfigurasi ${name}` })
  await expect(sheet).toBeVisible(); await waitForLocatorAnimations(sheet)
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  await page.waitForTimeout(250)
  return sheet
}
const STATES = [
  { key: "initial", vlan: "", ip: "10.10.10.41" },
  { key: "vlan20-valid", vlan: "20", ip: "10.99.20.41" },
  { key: "vlan20-outside", vlan: "20", ip: "10.99.10.41" },
  { key: "vlan30-auto", vlan: "30", ip: "10.99.30.5" },
  { key: "vlan99-unregistered", vlan: "99", ip: "10.10.10.41" },
  { key: "vlan99-outside", vlan: "99", ip: "10.99.20.41" },
]
const VLAN_SEL = ["#net-vlan", "#net-ip", "#net-prefix", "#net-gw", "#net-dns", "[data-slot=vlan-hint]", "[data-testid=net-ip-hint] .type-data, [data-testid=net-ip-hint] [data-slot=ip-token]", "[data-testid=vlan-unregistered] .type-data", "[data-slot=field-error] [data-slot=ip-token], [data-slot=field-error] .type-data"]

test("Sheet satu host — tab Network VLAN-aware", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 })
    const sheet = await openSingle(page, "storage-01")
    const per: Record<string, unknown> = {}
    for (const s of STATES) {
      await sheet.locator("#net-vlan").fill(s.vlan)
      await sheet.locator("#net-ip").fill(s.ip)
      await page.waitForTimeout(250)
      await sheet.locator("#net-vlan").scrollIntoViewIfNeeded()
      const texts = await sheet.evaluate((el) => {
        const pick = (sel: string) => [...el.querySelectorAll(sel)].map((e) => { const cs = getComputedStyle(e); return `${(e as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 140)} | ${cs.color} ${cs.fontSize} ${cs.fontFamily.slice(0, 12)}` })
        const sc = el.querySelector("[data-slot=sheet-content]") ?? el
        const save = [...el.querySelectorAll("button")].find((b) => /Simpan/.test(b.textContent ?? "")) as HTMLButtonElement | undefined
        const right = Math.max(...[...el.querySelectorAll("[data-slot=vlan-hint],[data-testid=vlan-unregistered],[data-testid=vlan-registered]")].map((e) => e.getBoundingClientRect().right), 0)
        return { errors: pick("[data-slot=field-error]"), descs: pick("[data-slot=field-description]"), alerts: pick("[role=alert]"), tabs: pick("[role=tab]"),
          save: save ? { disabled: save.disabled, bg: getComputedStyle(save).backgroundColor, opacity: getComputedStyle(save).opacity } : null,
          values: Object.fromEntries(["net-vlan", "net-ip", "net-prefix", "net-gw"].map((id) => [id, (el.querySelector(`#${id}`) as HTMLInputElement | null)?.value])),
          sheetRight: sc.getBoundingClientRect().right, hintRight: right, sheetOverflowX: (sc as HTMLElement).scrollWidth - (sc as HTMLElement).clientWidth }
      })
      per[s.key] = { texts, fonts: await fonts(page, VLAN_SEL), probe: await probe(page) }
      if ([375, 1440].includes(w)) await page.screenshot({ path: SH(`sheet-net-${s.key}-${w}`) })
      if ([375, 1440].includes(w) && s.key !== "initial") per[`${s.key}-axe`] = axeOut(await auditA11y(page, `dr sheet ${s.key}@${w}`, { include: '[data-slot="sheet-content"]' }))
    }
    out[w] = per
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0)
  }
  results["sheet-single"] = out
})

async function selectBulk(page: Page) {
  await page.goto("/hosts"); await settle(page)
  for (const m of BULK) await page.getByRole("checkbox", { name: `Pilih ${m}` }).click()
  return page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
}

test("Bulk VLAN 20: pratinjau + fokus keyboard region scroll (plan-table)", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of [375, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    const bar = await selectBulk(page)
    await bar.getByRole("button", { name: "Set IP" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
    await waitForLocatorAnimations(sheet)
    await sheet.locator("#net-vlan").fill("20")
    await sheet.locator("#net-start").fill("10.99.20.41")
    await sheet.locator("#net-end").fill("10.99.20.60")
    await page.waitForTimeout(300)
    const region = sheet.getByRole("region", { name: "Preview IP baru" })
    await expect(region).toBeVisible()
    await sheet.locator("#net-vlan").focus()
    // Tab maju dari field VLAN; bila region di atas, mundur dari #net-start.
    let steps = await tabTo(page, '[role=region][aria-label="Preview IP baru"]', 30)
    if (steps < 0) { await sheet.locator("#net-start").focus(); for (let i = 0; i < 30 && !(await region.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Shift+Tab"); steps = (await region.evaluate((e) => e === document.activeElement)) ? 99 : -1 }
    const f = await focusInfo(page)
    await region.screenshot({ path: SH(`focus-plan-table-${w}`) }).catch(() => {})
    await page.screenshot({ path: SH(`bulk-vlan20-preview-focus-${w}`) })
    const preview = await region.evaluate((el) => ({ rows: [...el.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((td) => `${(td as HTMLElement).innerText.trim()} | ${getComputedStyle(td.querySelector(".type-data") ?? td).fontFamily.slice(0, 14)}`)), ths: [...el.querySelectorAll("th")].map((t) => `${t.textContent} ${getComputedStyle(t).fontSize}/${getComputedStyle(t).fontWeight}`) }))
    // scroll dengan keyboard di region
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown")
    out[w] = { steps, focus: f, preview, probe: await probe(page), fonts: await fonts(page, VLAN_SEL) }
    out[`occl-${w}`] = await occlusion(page)
    if ([375, 1440].includes(w)) out[`axe-${w}`] = axeOut(await auditA11y(page, `dr bulk vlan20@${w}`, { include: '[data-slot="sheet-content"]' }))
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0)
  }
  results["bulk-plan"] = out
})

test("Bulk Credentials: region CSV preview + dialog password (fokus keyboard)", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    const bar = await selectBulk(page)
    await bar.getByRole("button", { name: "Set Credentials" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
    await waitForLocatorAnimations(sheet)
    await sheet.getByRole("radio", { name: "Import CSV" }).click()
    const pw = "Dummy-pass-" + "x".repeat(6)
    const csv = ["mac,username,password", `${BULK[0]},ops,${pw}`, `${BULK[1]},Root,pendek`, `52:54:00:10:10:11,ops,${pw}`, `${BULK[2]},ops,${pw}`, ...Array.from({ length: 10 }, (_, i) => `52:54:00:10:10:${(20 + i).toString()},ops,${pw}`)].join("\n")
    await sheet.locator("#cred-csv").fill(csv)
    await sheet.getByRole("button", { name: "Validasi CSV" }).click()
    const region = sheet.getByRole("region", { name: "Preview CSV credentials" })
    await expect(region).toBeVisible()
    await sheet.getByRole("button", { name: "Validasi CSV" }).focus()
    const steps = await tabTo(page, '[role=region][aria-label="Preview CSV credentials"]', 20)
    const f = await focusInfo(page)
    await region.scrollIntoViewIfNeeded()
    await page.screenshot({ path: SH(`focus-csv-preview-${w}`) })
    out[`csv-${w}`] = { steps, focus: f, probe: await probe(page) }
    out[`csv-occl-${w}`] = await occlusion(page)
    out[`csv-axe-${w}`] = axeOut(await auditA11y(page, `dr csv@${w}`, { include: '[data-slot="sheet-content"]' }))
    // password acak → dialog
    await sheet.getByRole("radio", { name: "Password acak per host" }).click()
    await sheet.locator("#cred-user").fill(`opsdr${w}`)
    // buka dialog lewat keyboard (Enter pada Simpan) → fokus awal harus terlihat
    await sheet.getByRole("button", { name: "Simpan konfigurasi" }).focus()
    await page.keyboard.press("Enter")
    const dlg = page.getByRole("dialog", { name: "Password acak dibuat" })
    await expect(dlg).toBeVisible(); await waitForAnimations(page)
    const pr = dlg.getByRole("region", { name: "Password yang dibuat" })
    await expect(pr).toBeVisible()
    let s2 = -1
    for (let i = 0; i < 15; i++) { if (await pr.evaluate((e) => e === document.activeElement)) { s2 = i; break } await page.keyboard.press("Tab") }
    const f2 = await focusInfo(page)
    await page.screenshot({ path: SH(`focus-passwords-dialog-${w}`), mask: [pr.locator("tbody td:nth-child(3)")] })
    await page.keyboard.press("Tab"); const next = await focusInfo(page)
    await page.keyboard.press("Shift+Tab"); const back = await focusInfo(page)
    await page.screenshot({ path: SH(`focus-passwords-dialog-back-${w}`), mask: [pr.locator("tbody td:nth-child(3)")] })
    out[`pw-${w}`] = { steps: s2, focus: f2, next, back, probe: await probe(page) }
    out[`pw-axe-${w}`] = axeOut(await auditA11y(page, `dr pwdialog@${w}`, { include: '[role="dialog"][aria-labelledby]' }).catch(async () => auditA11y(page, `dr pwdialog@${w}`)))
    await dlg.getByRole("checkbox", { name: "Saya sudah menyimpan password" }).click()
    await dlg.getByRole("button", { name: "Selesai" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  }
  results["bulk-cred"] = out
})
