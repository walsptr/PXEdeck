// Design-reviewer M6 iter1 — pengukuran computed style read-only. Output: results.json + shots/.
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"

const OUT = __dirname
mkdirSync(path.join(OUT, "shots"), { recursive: true })
const WIDTHS = [375, 414, 768, 800, 1024, 1279, 1280, 1440]
const results: Record<string, unknown> = {}
test.describe.configure({ mode: "serial" })
test.afterAll(() => writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1)))

async function login(page: Page) {
  const r = await page.request.post("/api/auth/login", {
    headers: { "content-type": "application/json" },
    data: { username: "admin-dr", password: process.env.DR_PASS },
  })
  expect(r.status()).toBe(204)
}

async function probe(page: Page) {
  return page.evaluate(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1
    const cx = cv.getContext("2d", { willReadFrequently: true })!
    const cache = new Map<string, number[]>()
    const rgba = (c: string) => {
      if (cache.has(c)) return cache.get(c)!
      cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1)
      const d = [...cx.getImageData(0, 0, 1, 1).data]; cache.set(c, d); return d
    }
    const hex = (d: number[]) => "#" + d.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("") + (d[3] < 255 ? `@${(d[3] / 255).toFixed(2)}` : "")
    const isOrange = (c: string) => { if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return false; const d = rgba(c); return d[3] > 0 && d[0] > 190 && d[1] > 40 && d[1] < 120 && d[2] < 60 }
    const PASTEL = ["#9fbbe0", "#dfa88f", "#c0a8dd", "#9fc9a2", "#c08532"]
    const vis = (el: Element) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0 }
    const desc = (el: Element) => { const h = el as HTMLElement; const t = (h.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 60); const tid = h.closest("[data-testid]")?.getAttribute("data-testid"); return `${el.tagName.toLowerCase()}${h.dataset.slot ? `[slot=${h.dataset.slot}]` : ""}${tid ? `{tid=${tid}}` : ""} "${t}" .${el.className.toString().slice(0, 70)}` }
    const shadows: string[] = [], rings: string[] = [], orange: string[] = [], pastel: string[] = []
    for (const el of document.querySelectorAll("body *")) {
      if (!vis(el)) continue
      const cs = getComputedStyle(el)
      const bs = cs.boxShadow
      if (bs && bs !== "none") {
        // pecah per lapisan; lapisan non-nol = ada offset/blur/spread dengan warna tidak transparan
        const layers = bs.split(/,(?![^(]*\))/)
        for (const L of layers) {
          const col = (L.match(/(rgba?|oklab|oklch|color|lab|lch)\([^)]*\)/) ?? [""])[0]
          const nums = L.replace(col, "").trim().split(/\s+/).filter((x) => /px$/.test(x)).map(parseFloat)
          const a = col ? rgba(col)[3] : 255
          if (a === 0 || nums.every((n) => n === 0)) continue
          const [ox = 0, oy = 0, blur = 0] = nums
          ;(ox || oy || blur ? shadows : rings).push(`${L.trim()} :: ${desc(el)}`)
        }
      }
      const props: [string, string][] = [["color", cs.color], ["bg", cs.backgroundColor]]
      if (parseFloat(cs.borderTopWidth) > 0) props.push(["border", cs.borderTopColor])
      if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) props.push(["outline", cs.outlineColor])
      if (bs !== "none" && /\(/.test(bs)) for (const m of bs.match(/(rgba?|oklab|oklch|color)\([^)]*\)/g) ?? []) props.push(["shadow", m])
      for (const [k, v] of props) if (isOrange(v) && (k !== "color" || ((el as HTMLElement).innerText ?? "").trim() || el.tagName === "svg")) orange.push(`${k}=${hex(rgba(v))} :: ${desc(el)}`)
      const bg = hex(rgba(cs.backgroundColor))
      if (PASTEL.includes(bg)) pastel.push(`${bg} :: ${desc(el)}`)
    }
    // mono untuk data teknis
    const RX: [string, RegExp][] = [
      ["mac", /\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i], ["ip", /\b\d{1,3}(\.\d{1,3}){3}(\/\d+)?\b/],
      ["path", /(^|[\s(“"'])\/?[\w.-]+\/[\w.-]+\/[\w./-]+/], ["hash", /SHA256:[A-Za-z0-9+/]{20,}|\b[0-9a-f]{32,}\b/i],
    ]
    const nonMono: string[] = []
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = tw.nextNode())) {
      const p = n.parentElement!; if (!p || !vis(p) || p.closest("script,style,.sr-only")) continue
      const t = n.textContent ?? ""
      for (const [k, re] of RX) {
        const m = re.exec(t); if (!m) continue
        const ff = getComputedStyle(p).fontFamily
        if (!/JetBrains/i.test(ff)) nonMono.push(`${k}: "${m[0].trim()}" in "${t.trim().slice(0, 80)}" font=${ff.slice(0, 25)} :: ${desc(p)}`)
      }
    }
    for (const inp of document.querySelectorAll("input,textarea")) {
      const v = (inp as HTMLInputElement).value; if (!v || !vis(inp)) continue
      for (const [k, re] of RX) if (re.test(v) && !/JetBrains/i.test(getComputedStyle(inp).fontFamily)) nonMono.push(`input-${k}: "${v.slice(0, 40)}" :: ${desc(inp)}`)
    }
    // muted pada informasi penting
    const MUTED = "#807d72"
    const IMPORTANT = /gagal|failed|error|galat|tidak tersedia|ditolak|kedaluwarsa|tidak ditemukan|timeout|salah|offline|tidak bisa|melebihi/i
    const mutedImportant: string[] = []
    const mutedAll: string[] = []
    for (const el of document.querySelectorAll("body *")) {
      if (!vis(el)) continue
      const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join("").trim()
      if (!own) continue
      if (hex(rgba(getComputedStyle(el).color)) !== MUTED) continue
      mutedAll.push(own.slice(0, 70))
      const inAlert = el.closest('[role=alert],[data-slot=badge],[data-status]')
      if (IMPORTANT.test(own) || inAlert) mutedImportant.push(`"${own.slice(0, 90)}" :: ${desc(el)}`)
    }
    const titles = [...document.querySelectorAll("h1")].filter(vis).map((h) => { const cs = getComputedStyle(h); return `${h.textContent?.trim()} ${cs.fontSize}/${cs.fontWeight} ls=${cs.letterSpacing} ff=${cs.fontFamily.slice(0, 14)} color=${hex(rgba(cs.color))}` })
    const offenders: string[] = []
    const vw = window.innerWidth
    for (const el of document.querySelectorAll("body *")) {
      if (!vis(el) || el.closest("[data-sonner-toaster],.sr-only")) continue
      const r = el.getBoundingClientRect()
      if (r.right > vw + 0.5) offenders.push(`${desc(el)} right=${Math.round(r.right)}`)
    }
    return {
      bodyBg: hex(rgba(getComputedStyle(document.body).backgroundColor)), vw,
      docScrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 6),
      shadows: [...new Set(shadows)], rings: [...new Set(rings)].slice(0, 15), orange: [...new Set(orange)], pastel: [...new Set(pastel)],
      nonMono: [...new Set(nonMono)].slice(0, 30), mutedImportant: [...new Set(mutedImportant)], mutedSample: [...new Set(mutedAll)].slice(0, 60), titles,
    }
  })
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(400)
}

test("login page — semua lebar + keyboard", async ({ page }) => {
  const rows: Record<string, unknown> = {}
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/login")
    await settle(page)
    const p = await probe(page)
    const card = await page.getByTestId("login-card").evaluate((el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { bg: cs.backgroundColor, border: `${cs.borderTopWidth} ${cs.borderTopColor}`, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, pad: cs.paddingTop, width: r.width } })
    const fields = await page.evaluate(() => ["login-username", "login-password"].map((id) => { const e = document.getElementById(id)!; const host = e.closest("[data-slot=input-group]") ?? e; const cs = getComputedStyle(host); return { id, h: host.getBoundingClientRect().height, radius: cs.borderTopLeftRadius, ff: getComputedStyle(e).fontFamily.slice(0, 20) } }))
    const btn = await page.getByTestId("login-submit").evaluate((el) => { const cs = getComputedStyle(el); return { h: el.getBoundingClientRect().height, bg: cs.backgroundColor, fs: cs.fontSize, fw: cs.fontWeight, radius: cs.borderTopLeftRadius } })
    rows[w] = { ...p, card, fields, btn }
    if ([375, 1440].includes(w)) await page.screenshot({ path: path.join(OUT, "shots", `login-${w}.png`), fullPage: true })
  }
  // keyboard
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/login"); await settle(page)
  const focusInfo = () => page.evaluate(() => { const a = document.activeElement as HTMLElement; const t = a.closest("[data-slot=input-group]") ?? a; const cs = getComputedStyle(t); const cs2 = getComputedStyle(a); return { el: `${a.tagName}#${a.id}[${a.getAttribute("aria-label") ?? a.textContent?.trim()}]`, fv: a.matches(":focus-visible"), boxShadow: cs.boxShadow + " | " + cs2.boxShadow, outline: `${cs2.outlineStyle} ${cs2.outlineWidth} ${cs2.outlineColor}`, border: cs.borderTopColor } })
  const seq = [await focusInfo()]
  for (let i = 0; i < 4; i++) { await page.keyboard.press("Tab"); seq.push(await focusInfo()) }
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab")
  await page.screenshot({ path: path.join(OUT, "shots", "login-kbd-toggle-focus.png") })
  await page.keyboard.press("Tab")
  await page.screenshot({ path: path.join(OUT, "shots", "login-kbd-submit-focus.png") })
  // error flow via keyboard
  await page.locator("#login-username").fill("admin-dr")
  await page.locator("#login-password").fill("salah-password-xxx")
  await page.locator("#login-password").press("Enter")
  await expect(page.getByTestId("login-error")).toBeVisible()
  const afterErr = await focusInfo()
  const alert = await page.getByTestId("login-error").evaluate((el) => { const cs = getComputedStyle(el); const d = el.querySelector("[data-slot=alert-description]")!; return { color: cs.color, desc: getComputedStyle(d).color, border: cs.borderTopColor, bg: cs.backgroundColor } })
  await page.screenshot({ path: path.join(OUT, "shots", "login-error-kbd.png") })
  // Tab dari alert
  await page.keyboard.press("Tab"); const afterAlertTab = await focusInfo()
  results["login"] = { rows, seq, afterErr, alert, afterAlertTab }
})

const PAGES = ["/hosts", "/jobs", "/jobs?job=job-m6ui-007", "/os-images", "/ssh-keys", "/settings", "/jobs?job=tidak-ada-xyz", "/jobs?host=tidak-ada"]
for (const pth of PAGES) {
  test(`halaman ${pth}`, async ({ page }) => {
    await login(page)
    const rows: Record<string, unknown> = {}
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto(pth)
      await settle(page)
      rows[w] = await probe(page)
      if ([375, 768, 1280, 1440].includes(w)) await page.screenshot({ path: path.join(OUT, "shots", `${pth.replace(/[/?=&]/g, "_")}-${w}.png`), fullPage: true })
    }
    results[pth] = rows
  })
}

test("Sheet konfigurasi host", async ({ page }) => {
  await login(page)
  const rows: Record<string, unknown> = {}
  for (const w of [375, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts"); await settle(page)
    await page.getByRole("button", { name: /^Aksi untuk/ }).first().click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    await expect(page.getByRole("dialog")).toBeVisible(); await settle(page)
    const tabs = await page.getByRole("tab").allTextContents()
    const perTab: Record<string, unknown> = {}
    for (const t of tabs) {
      await page.getByRole("tab", { name: t, exact: true }).click(); await page.waitForTimeout(250)
      perTab[t] = await probe(page)
      if (w !== 768) await page.screenshot({ path: path.join(OUT, "shots", `sheet-${t.replace(/\W+/g, "")}-${w}.png`) })
    }
    rows[w] = perTab
  }
  results["sheet"] = rows
})

test("logout keyboard + sidebar collapsed + mobile", async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/hosts"); await settle(page)
  const user = await page.getByTestId("sidebar-username").evaluate((el) => { const cs = getComputedStyle(el); return { ff: cs.fontFamily.slice(0, 20), fs: cs.fontSize, color: cs.color, text: el.textContent } })
  const btn = await page.getByTestId("logout").evaluate((el) => { const cs = getComputedStyle(el); return { fs: cs.fontSize, fw: cs.fontWeight, color: cs.color, bg: cs.backgroundColor } })
  let reached = -1
  await page.locator("body").click({ position: { x: 5, y: 890 } }).catch(() => {})
  for (let i = 0; i < 40; i++) { await page.keyboard.press("Tab"); if (await page.getByTestId("logout").evaluate((e) => e === document.activeElement)) { reached = i + 1; break } }
  const focus = await page.getByTestId("logout").evaluate((el) => { const cs = getComputedStyle(el); return { fv: el.matches(":focus-visible"), boxShadow: cs.boxShadow, outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` } })
  await page.screenshot({ path: path.join(OUT, "shots", "logout-kbd-focus-1440.png") })
  // collapsed
  await page.keyboard.press("Control+b"); await page.waitForTimeout(400)
  const collapsed = await page.getByTestId("logout").evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, visible: r.width > 0, label: el.getAttribute("aria-label") ?? el.textContent } })
  await page.screenshot({ path: path.join(OUT, "shots", "sidebar-collapsed-1440.png") })
  await page.keyboard.press("Control+b"); await page.waitForTimeout(300)
  // mobile
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto("/hosts"); await settle(page)
  await page.getByRole("button", { name: /sidebar/i }).first().click(); await page.waitForTimeout(400)
  const mobileVisible = await page.getByTestId("logout").isVisible()
  await page.screenshot({ path: path.join(OUT, "shots", "sidebar-mobile-375.png") })
  await page.keyboard.press("Escape")
  // logout via Enter
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/hosts"); await settle(page)
  await page.getByTestId("logout").focus(); await page.keyboard.press("Enter")
  await page.waitForURL(/\/login/)
  const afterLogout = page.url()
  await settle(page)
  const loginFocus = await page.evaluate(() => document.activeElement?.id)
  await page.screenshot({ path: path.join(OUT, "shots", "after-logout.png") })
  results["logout"] = { user, btn, reached, focus, collapsed, mobileVisible, afterLogout, loginFocus }
})
