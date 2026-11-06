// Design-reviewer M6 iter2 — cek terarah DR-6-1..8 + axe. Read-only. Output: targets.json + shots/.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { auditA11y } from "../../../../../dashboard/e2e/support/axe"

const OUT = __dirname
mkdirSync(path.join(OUT, "shots"), { recursive: true })
const WIDTHS = [375, 414, 768, 800, 1024, 1279, 1280, 1440]
const R: Record<string, unknown> = {}
test.describe.configure({ mode: "serial" })
test.afterAll(() => writeFileSync(path.join(OUT, "targets.json"), JSON.stringify(R, null, 1)))

async function login(page: Page) {
  const r = await page.request.post("/api/auth/login", { headers: { "content-type": "application/json" }, data: { username: "admin-dr", password: process.env.DR_PASS } })
  expect(r.status()).toBe(204)
}
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(400)
}
/** warna computed → hex (via canvas) untuk semua elemen selector, + ikon svg / font */
const colors = (page: Page, sel: string) => page.evaluate((sel) => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1
  const cx = cv.getContext("2d", { willReadFrequently: true })!
  const hex = (c: string) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = [...cx.getImageData(0, 0, 1, 1).data]; return "#" + d.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("") }
  return [...document.querySelectorAll(sel)].filter((e) => (e as HTMLElement).offsetParent !== null || e.getClientRects().length).map((e) => {
    const parts = [e, ...e.querySelectorAll("*")].filter((x) => [...x.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())).map((x) => `${hex(getComputedStyle(x).color)} "${[...x.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join("").trim().slice(0, 50)}"`)
    return { text: (e as HTMLElement).innerText.trim().slice(0, 100), color: hex(getComputedStyle(e).color), svg: !!e.querySelector("svg"), svgColor: e.querySelector("svg") ? hex(getComputedStyle(e.querySelector("svg")!).color) : null, parts }
  })
}, sel)

test("R1/R2/R3 warna informasi penting", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 })
    const row: Record<string, unknown> = {}
    await page.goto("/jobs"); await settle(page)
    row.jobRowFailure = await colors(page, "[data-testid=job-row-failure]")
    await page.goto("/hosts"); await settle(page)
    row.hostFailure = await colors(page, "[data-testid=host-failure-reason]")
    await page.goto("/jobs?job=job-iter2-failed-001"); await settle(page)
    row.timeline = await colors(page, "[data-testid=timeline-step] [data-slot=badge]")
    await page.goto("/os-images"); await settle(page)
    row.osUnavailable = await colors(page, "[data-testid=img-available][data-available=false]")
    out[w] = row
  }
  R.colors = out
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/jobs?job=job-iter2-failed-001"); await settle(page)
  await page.getByTestId("job-timeline").screenshot({ path: path.join(OUT, "shots", "timeline-failed-1440.png") })
  await page.goto("/os-images"); await settle(page)
  await page.locator("[data-testid=img-available][data-available=false]").first().screenshot({ path: path.join(OUT, "shots", "os-unavailable-1440.png") })
})

test("R1/R3 Sheet host Failed + tab OS", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of [375, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts"); await settle(page)
    await page.getByRole("button", { name: /^Aksi untuk.*compute-03/ }).first().click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    await expect(page.getByRole("dialog")).toBeVisible(); await settle(page)
    const last = await colors(page, "[data-testid=sheet-last-job-failure]")
    await page.getByTestId("sheet-last-job-failure").screenshot({ path: path.join(OUT, "shots", `sheet-last-failure-${w}.png`) })
    await page.getByRole("tab", { name: "OS", exact: true }).click(); await page.waitForTimeout(300)
    const notes = await colors(page, "[data-testid=os-option-note]")
    if (w === 1440) await page.getByRole("dialog").screenshot({ path: path.join(OUT, "shots", "sheet-os-notes-1440.png") })
    out[w] = { last, notes }
  }
  R.sheet = out
})

test("R1 log viewer not-found / session", async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  const out: Record<string, unknown> = {}
  for (const [state, body] of [["not-found", { status: "deleted" }], ["session", { reason: "session" }]] as const) {
    await page.route("**/api/jobs/job-m6ui-007/logs**", (route) => route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store" }, body: `event: end\ndata: ${JSON.stringify(body)}\n\n` }))
    await page.goto("/jobs?job=job-m6ui-007")
    const el = page.locator(`[data-testid=log-empty][data-state=${state}]`)
    await el.waitFor({ timeout: 15000 }).catch(() => {})
    out[state] = (await el.count()) ? { ...(await colors(page, `[data-testid=log-empty][data-state=${state}]`))[0] } : { missing: true, url: page.url() }
    if (await el.count()) await el.screenshot({ path: path.join(OUT, "shots", `log-${state}-1440.png`) }).catch(() => {})
    await page.unroute("**/api/jobs/job-m6ui-007/logs**")
    if (state === "session") break
  }
  R.log = out
})

test("R7 server status tanpa warna", async ({ page }) => {
  await login(page)
  const real = await (await page.request.get("/api/server-status")).json()
  const out: Record<string, unknown> = { real: real.services.map((s: { name: string; state: string }) => `${s.name}=${s.state}`) }
  const states = ["online", "offline", "unknown"]
  await page.route("**/api/server-status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...real, services: real.services.map((s: Record<string, unknown>, i: number) => ({ ...s, state: states[i], online: states[i] === "online" })) }) }))
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts"); await settle(page)
    out[w] = await page.evaluate(() => [...document.querySelectorAll("[data-service]")].map((b) => {
      const name = b.querySelector("[data-slot=service-name]") as HTMLElement
      const dot = b.querySelector("[data-slot=status-dot]") as HTMLElement
      const nr = name?.getBoundingClientRect(); const br = b.getBoundingClientRect()
      const cs = getComputedStyle(dot)
      return { svc: b.getAttribute("data-service"), state: b.getAttribute("data-state"), nameVisible: !!nr && nr.width > 4 && getComputedStyle(name).position !== "absolute", nameW: Math.round(nr?.width ?? 0), nameText: name?.textContent, badge: `${Math.round(br.width)}x${Math.round(br.height)} right=${Math.round(br.right)}`, glyph: dot.getAttribute("data-glyph"), dotBg: cs.backgroundColor, dotBorder: `${cs.borderTopWidth} ${cs.borderTopStyle}`, iconPath: (dot.querySelector("svg")?.innerHTML ?? "").slice(0, 80), iconColor: getComputedStyle(dot.querySelector("svg")!).color }
    }))
    const box = await page.locator("[data-service]").first().evaluate((e) => { const r = e.parentElement!.parentElement!.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
    await page.screenshot({ path: path.join(OUT, "shots", `server-status-${w}.png`), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 6), width: Math.min(w - Math.max(0, box.x - 8), box.w + 16), height: box.h + 12 } })
    await page.screenshot({ path: path.join(OUT, "shots", `topbar-${w}.png`), clip: { x: 0, y: 0, width: w, height: 64 } })
  }
  // grayscale proof
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/hosts"); await settle(page)
  await page.addStyleTag({ content: "html{filter:grayscale(1)}" })
  const box = await page.locator("[data-service]").first().evaluate((e) => { const r = e.parentElement!.parentElement!.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
  await page.screenshot({ path: path.join(OUT, "shots", "server-status-gray-1440.png"), clip: { x: box.x - 8, y: box.y - 6, width: box.w + 16, height: box.h + 12 }, scale: "device" })
  R.serverStatus = out
})

const focusStyle = (page: Page, sel: string) => page.evaluate((sel) => {
  const e = document.querySelector(sel) as HTMLElement
  const t = e.closest("[data-slot=input-group]") ?? e
  const cs = getComputedStyle(t)
  let bgEl: Element | null = t.parentElement; let bg = "rgba(0, 0, 0, 0)"
  while (bgEl && (bg = getComputedStyle(bgEl).backgroundColor) === "rgba(0, 0, 0, 0)") bgEl = bgEl.parentElement
  return { el: sel, fv: e.matches(":focus-visible"), border: `${cs.borderTopWidth} ${cs.borderTopColor}`, boxShadow: cs.boxShadow, surroundBg: bg, fieldBg: cs.backgroundColor }
}, sel)

test("DR-6-4 ring fokus input", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/login"); await settle(page)
  await page.locator("body").click({ position: { x: 5, y: 5 } })
  const before = await focusStyle(page, "#login-username")
  await page.locator("#login-username").focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); await page.waitForTimeout(300)
  const user = await focusStyle(page, "#login-username")
  await page.screenshot({ path: path.join(OUT, "shots", "focus-login-username.png"), clip: { x: 520, y: 380, width: 400, height: 300 } })
  await page.keyboard.press("Tab"); await page.waitForTimeout(300)
  const pass = await focusStyle(page, "#login-password")
  await page.screenshot({ path: path.join(OUT, "shots", "focus-login-password-group.png"), clip: { x: 520, y: 380, width: 400, height: 300 } })
  // Sheet input
  await login(page)
  await page.goto("/hosts"); await settle(page)
  await page.getByRole("button", { name: /^Aksi untuk/ }).first().click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  await expect(page.getByRole("dialog")).toBeVisible(); await settle(page)
  const hn = page.getByRole("dialog").locator("input").first()
  await hn.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); await page.waitForTimeout(300)
  const sheetInput = await page.evaluate(() => { const a = document.activeElement as HTMLElement; return a.id ? `#${a.id}` : a.tagName })
  const sheet = sheetInput.startsWith("#") ? await focusStyle(page, sheetInput) : { el: sheetInput }
  await page.getByRole("dialog").screenshot({ path: path.join(OUT, "shots", "focus-sheet-input-1440.png") })
  R.focus = { before, user, pass, sheet }
})

test("DR-6-6 hostname panjang / scroll tabel", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts"); await settle(page)
    out[w] = await page.evaluate(() => {
      const table = document.querySelector("table")!
      const sc = table.closest("[data-slot=table-container]") ?? table.parentElement!
      const sr = sc.getBoundingClientRect()
      const hn = document.querySelector("[data-testid=host-hostname]") as HTMLElement | null
      const ths = [...table.querySelectorAll("thead th")].map((th) => { const r = th.getBoundingClientRect(); return `${(th as HTMLElement).innerText.trim() || "(aksi)"}:${Math.round(r.left)}-${Math.round(r.right)}${r.right > sr.right + 0.5 ? " HIDDEN" : ""}` })
      return { containerW: Math.round(sr.width), scrollW: sc.scrollWidth, clientW: sc.clientWidth, overflowPx: sc.scrollWidth - sc.clientWidth, tableW: Math.round(table.getBoundingClientRect().width), docOverflow: document.documentElement.scrollWidth - window.innerWidth, hostnameCellW: hn ? Math.round(hn.getBoundingClientRect().width) : null, hostnameTitle: hn?.title?.length, truncated: hn ? hn.scrollWidth > hn.clientWidth : null, ths }
    })
    if ([1024, 1280, 1440].includes(w)) await page.screenshot({ path: path.join(OUT, "shots", `hosts-table-${w}.png`) })
  }
  // tanpa hostname panjang: berapa overflow pada 1440 bila hostname dipendekkan di DOM (pembanding, hanya di browser)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/hosts"); await settle(page)
  out.compare1440_shortHostname = await page.evaluate(async () => {
    const hn = document.querySelector("[data-testid=host-hostname]") as HTMLElement; hn.textContent = "node-01"
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const table = document.querySelector("table")!; const sc = table.closest("[data-slot=table-container]") ?? table.parentElement!
    return { overflowPx: sc.scrollWidth - sc.clientWidth, ths: [...table.querySelectorAll("thead th")].map((th) => `${(th as HTMLElement).innerText.trim() || "(aksi)"}:${Math.round(th.getBoundingClientRect().width)}`) }
  })
  R.hostname = out
})

test("DR-6-7 CIDR mono di error + DR-6-8 job not-found", async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/hosts"); await settle(page)
  await page.getByRole("button", { name: /^Aksi untuk/ }).nth(1).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  await expect(page.getByRole("dialog")).toBeVisible(); await settle(page)
  await page.getByRole("tab", { name: "Network", exact: true }).click()
  await page.getByRole("radio", { name: "Static" }).click().catch(async () => page.getByText("Static", { exact: true }).click())
  await page.locator("#net-ip").fill("192.168.5.20"); await page.waitForTimeout(300)
  const cidr = await page.evaluate(() => { const fe = document.querySelector("[data-slot=field-error]") as HTMLElement | null; if (!fe) return null; return { text: fe.innerText, outerFont: getComputedStyle(fe).fontFamily.slice(0, 20), tokens: [...fe.querySelectorAll("[data-slot=ip-token]")].map((t) => `${t.textContent} :: ${getComputedStyle(t).fontFamily.slice(0, 20)} ${getComputedStyle(t).color}`) } })
  await page.locator("#net-ip").locator("xpath=..").screenshot({ path: path.join(OUT, "shots", "network-cidr-error-1440.png") }).catch(() => {})
  await page.getByRole("dialog").screenshot({ path: path.join(OUT, "shots", "sheet-network-error-1440.png") })
  await page.keyboard.press("Escape")
  const nf: Record<string, unknown> = {}
  for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/jobs?job=tidak-ada-xyz"); await settle(page)
    nf[w] = await page.evaluate(() => { const a = document.querySelector("[data-testid=job-detail-error]") as HTMLElement | null; return a ? { title: (a.querySelector("[data-slot=alert-title]") as HTMLElement)?.innerText, desc: (a.querySelector("[data-slot=alert-description]") as HTMLElement)?.innerText, log: (document.querySelector("[data-testid=log-empty]") as HTMLElement | null)?.innerText ?? null } : { missing: true, body: document.body.innerText.slice(0, 300) } })
    await page.locator("[data-testid=job-detail-error]").screenshot({ path: path.join(OUT, "shots", `job-notfound-${w}.png`) }).catch(() => {})
  }
  R.cidr = cidr; R.notFound = nf
})

test("axe semua halaman 375/1440", async ({ page }) => {
  await login(page)
  const out: Record<string, unknown> = {}
  for (const w of [375, 1440]) for (const p of ["/hosts", "/jobs", "/jobs?job=job-iter2-failed-001", "/jobs?job=tidak-ada-xyz", "/os-images", "/ssh-keys", "/settings"]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto(p); await settle(page)
    const a = await auditA11y(page, `dr ${p}@${w}`)
    out[`${p}@${w}`] = { violations: a.violations, filtered: a.filtered.reduce<Record<string, number>>((m, f) => ({ ...m, [f.category]: (m[f.category] ?? 0) + 1 }), {}) }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/hosts"); await settle(page)
  await page.getByRole("button", { name: /^Aksi untuk.*compute-03/ }).first().click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  await expect(page.getByRole("dialog")).toBeVisible(); await settle(page)
  for (const t of ["Hostname", "OS"]) {
    await page.getByRole("tab", { name: t, exact: true }).click(); await page.waitForTimeout(300)
    const a = await auditA11y(page, `dr sheet ${t}@1440`, { include: '[data-slot="sheet-content"]' })
    out[`sheet ${t}`] = { violations: a.violations, filtered: a.filtered.reduce<Record<string, number>>((m, f) => ({ ...m, [f.category]: (m[f.category] ?? 0) + 1 }), {}) }
  }
  R.axe = out
})
