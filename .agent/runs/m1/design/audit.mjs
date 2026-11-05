// Design audit read-only (design-reviewer). Jalankan dari dashboard/:
//   node ../.agent/runs/m1/design/audit.mjs   (server: PXE_MOCK_SIMULATION=off next start -p 3200)
// Tidak ada request simpan/install: dialog install ditutup dengan "Batal".
// Iter2: output ke m{1,2,3}/design/iter2/. State baru memakai page.route (stub di browser,
// server tidak dimutasi): empty state /hosts, error state Sheet, dialog password acak (dummy).
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(path.join(process.cwd(), "package.json"))
const { chromium } = require("playwright")

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNS = path.resolve(HERE, "../..")
const BASE = process.env.BASE_URL ?? "http://localhost:3200"
const OUT = process.env.AUDIT_OUT ?? "iter2"
const outDir = (m) => path.join(RUNS, `m${m}`, "design", OUT)
for (const m of [1, 2, 3]) mkdirSync(outDir(m), { recursive: true })
const shot = (m, name) => path.join(outDir(m), `${name}.png`)

// ---------- pengukuran di browser ----------
function measure() {
  const ORANGE = ["rgb(245, 78, 0)", "rgb(208, 66, 0)"]
  const PASTEL = {
    "rgb(159, 187, 224)": "discovered", "rgb(223, 168, 143)": "booting",
    "rgb(192, 168, 221)": "installing", "rgb(159, 201, 162)": "configuring",
    "rgb(192, 133, 50)": "done",
  }
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const desc = (el) => ({
    tag: el.tagName.toLowerCase(),
    slot: el.dataset?.slot ?? null,
    variant: el.dataset?.variant ?? null,
    size: el.dataset?.size ?? null,
    role: el.getAttribute("role"),
    ariaLabel: el.getAttribute("aria-label"),
    id: el.id || null,
    text: (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
    cls: String(el.className?.baseVal ?? el.className ?? "").slice(0, 120),
  })
  const isFocus = (el) => el.matches(":focus-visible") || el.matches(":focus") || el.matches(":focus-within") || !!el.querySelector(":focus-visible")
  const splitLayers = (s) => {
    const out = []; let d = 0, cur = ""
    for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { out.push(cur.trim()); cur = "" } else cur += ch }
    out.push(cur.trim()); return out
  }
  const all = Array.from(document.querySelectorAll("body *")).filter(vis)

  // shadows
  const shadows = []
  for (const el of all) {
    const bs = getComputedStyle(el).boxShadow
    if (bs === "none") continue
    const layers = splitLayers(bs).map((l) => {
      const color = (l.match(/(rgba?|oklch|oklab|lab|color)\([^)]*\)/) ?? [""])[0]
      const nums = l.replace(color, "").replace("inset", "").trim().split(/\s+/).filter(Boolean).map(parseFloat)
      const [x = 0, y = 0, blur = 0, spread = 0] = nums
      const transparent = /rgba\([^)]*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color) || color === "rgba(0, 0, 0, 0)"
      return { x, y, blur, spread, color, inset: l.includes("inset"), transparent }
    })
    const visible = layers.filter((l) => !l.transparent && (l.x || l.y || l.blur || l.spread))
    if (!visible.length) continue // hanya lapisan transparan/nol (default Tailwind)
    const kind = visible.some((l) => l.x || l.y || l.blur) ? "drop" : "ring"
    shadows.push({ ...desc(el), kind, focus: isFocus(el), boxShadow: bs })
  }

  // oranye
  const orange = []
  for (const el of all) {
    const cs = getComputedStyle(el)
    const hits = []
    if (ORANGE.includes(cs.backgroundColor)) hits.push("background")
    if (ORANGE.includes(cs.color) && (el.innerText ?? "").trim()) hits.push("color")
    for (const s of ["Top", "Right", "Bottom", "Left"])
      if (parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none" && ORANGE.includes(cs[`border${s}Color`])) { hits.push("border"); break }
    if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && ORANGE.includes(cs.outlineColor)) hits.push("outline")
    if (el instanceof SVGElement) {
      if (ORANGE.includes(cs.fill)) hits.push("fill")
      if (ORANGE.includes(cs.stroke) && cs.stroke !== "none") hits.push("stroke")
    }
    if (/rgb\(245, 78, 0\)|rgb\(208, 66, 0\)|rgba\(245, 78, 0/.test(cs.boxShadow)) hits.push("box-shadow")
    if (hits.length) orange.push({ ...desc(el), props: hits, focus: isFocus(el), cta: el.dataset?.slot === "button" && el.dataset?.variant === "default" || el.dataset?.slot === "alert-dialog-action" })
  }

  // pastel
  const pastel = []
  for (const el of all) {
    const cs = getComputedStyle(el)
    for (const p of ["backgroundColor", "color", "borderTopColor"]) {
      const v = cs[p]
      if (PASTEL[v] && (p !== "borderTopColor" || parseFloat(cs.borderTopWidth) > 0) && (p !== "color" || (el.innerText ?? "").trim()))
        pastel.push({ ...desc(el), prop: p, stage: PASTEL[v], inPill: !!el.closest("[data-status]") })
    }
  }

  // pill status
  const pills = Array.from(document.querySelectorAll("[data-status]")).filter(vis).map((el) => {
    const cs = getComputedStyle(el)
    return { status: el.dataset.status, text: el.innerText.trim(), bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, height: el.getBoundingClientRect().height, fontSize: cs.fontSize, fontWeight: cs.fontWeight }
  })

  // data teknis: leaf element dengan teks MAC/IP/hostname/key/fingerprint
  const RX = {
    mac: /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i,
    ip: /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/,
    key: /^(ssh-(ed25519|rsa)|ecdsa-sha2-)|^SHA256:/,
    hostname: /^[a-z][a-z0-9-]*-\d{1,3}[a-z0-9-]*$/,
    keytype: /^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-nistp\d+)$/,
  }
  const tech = []
  const leafs = all.filter((el) => !(el instanceof SVGElement) && el.children.length === 0)
  for (const el of leafs) {
    const t = (el.innerText ?? "").trim()
    for (const [k, rx] of Object.entries(RX)) {
      if (rx.test(t)) { tech.push({ kind: k, ...desc(el), font: getComputedStyle(el).fontFamily, mono: getComputedStyle(el).fontFamily.startsWith('"JetBrains Mono') }); break }
    }
  }
  // input yang berisi data teknis (IP, hostname, key)
  for (const el of all.filter((e) => e.matches("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea"))) {
    const v = (el.value || el.placeholder || "").trim()
    let kind = null
    for (const [k, rx] of Object.entries(RX)) if (rx.test(v) || (k === "key" && /ssh-|ecdsa/.test(v))) { kind = k; break }
    if (/(ip|gw|gateway|dns|hn|host|mac|key|ssh|start|end|prefix|template)/i.test(el.id + " " + (el.name || "")) && !kind) kind = "field:" + (el.id || el.name)
    if (kind) tech.push({ kind: "input-" + kind, ...desc(el), value: v.slice(0, 40), font: getComputedStyle(el).fontFamily, mono: getComputedStyle(el).fontFamily.startsWith('"JetBrains Mono') })
  }

  // judul halaman
  const h1 = document.querySelector("header h1")
  const title = h1 && (() => { const cs = getComputedStyle(h1); return { text: h1.innerText, fontSize: cs.fontSize, fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing, color: cs.color, font: cs.fontFamily } })()
  const headerH = document.querySelector("header")?.getBoundingClientRect().height ?? null

  // label kolom tabel
  const th = Array.from(document.querySelectorAll("th")).filter(vis).filter((e) => e.innerText.trim()).map((e) => {
    const inner = e.querySelector("button") ?? e
    const cs = getComputedStyle(inner)
    return { text: e.innerText.trim(), inSheet: !!e.closest("[data-slot=sheet-content]"), fontSize: cs.fontSize, fontWeight: cs.fontWeight, textTransform: cs.textTransform, letterSpacing: cs.letterSpacing, color: cs.color }
  })

  // radius & tinggi
  const shape = (sel) => Array.from(document.querySelectorAll(sel)).filter(vis).map((el) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    return { ...desc(el), radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].join(" "), height: Math.round(r.height * 10) / 10, bg: cs.backgroundColor, inSheet: !!el.closest("[data-slot=sheet-content],[data-slot=dialog-content],[data-slot=alert-dialog-content]"), inTable: !!el.closest("table") }
  })
  const shapes = {
    buttons: shape("[data-slot=button],[data-slot=input-group-button],[data-slot=alert-dialog-action],[data-slot=alert-dialog-cancel]"),
    inputs: shape("[data-slot=input],[data-slot=select-trigger],[data-slot=textarea],[data-slot=input-group]"),
    cards: shape("[data-slot=card]"),
    dialogs: shape("[data-slot=dialog-content],[data-slot=alert-dialog-content],[data-slot=sheet-content],[data-slot=dropdown-menu-content],[data-slot=popover-content]"),
    badges: shape("[data-slot=badge]"),
  }

  const body = getComputedStyle(document.body)
  const vw = document.documentElement.clientWidth
  const overflow = {
    scrollWidth: document.documentElement.scrollWidth, clientWidth: vw,
    offenders: all.filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 && !el.closest("[data-slot=table-container],.overflow-x-auto,.overflow-auto,[data-radix-scroll-area-viewport]") })
      .filter((el) => { const p = el.parentElement; return !p || p.getBoundingClientRect().right <= vw + 1 })
      .slice(0, 15).map((el) => ({ ...desc(el), right: Math.round(el.getBoundingClientRect().right) })),
  }
  const sidebarIp = (() => {
    const el = document.querySelector("[data-slot=sidebar] .type-data, [data-sidebar=sidebar] .type-data")
    if (!el) return null
    const cs = getComputedStyle(el)
    return { text: el.innerText.trim(), font: cs.fontFamily, mono: cs.fontFamily.startsWith('"JetBrains Mono'), fontSize: cs.fontSize, color: cs.color }
  })()
  const checkboxes = Array.from(document.querySelectorAll("[data-slot=checkbox]")).filter(vis).map((el) => {
    const cs = getComputedStyle(el)
    return { ...desc(el), state: el.dataset.state ?? (el.hasAttribute("data-checked") ? "checked" : null), bg: cs.backgroundColor, border: cs.borderTopColor, radius: cs.borderTopLeftRadius, size: el.getBoundingClientRect().width }
  })
  const alerts = Array.from(document.querySelectorAll("[data-slot=alert]")).filter(vis).map((el) => {
    const cs = getComputedStyle(el)
    return { ...desc(el), bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, radius: cs.borderTopLeftRadius }
  })
  return { sidebarIp, checkboxes, alerts, url: location.pathname + location.search, bodyBg: body.backgroundColor, bodyColor: body.color, htmlFont: getComputedStyle(document.documentElement).fontFamily, title, headerH, th, shadows, orange, pastel, pills, tech, shapes, overflow }
}

// ---------- skenario ----------
const results = { base: BASE, at: new Date().toISOString(), states: [] }
const browser = await chromium.launch()

async function newPage(width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" })
  const page = await ctx.newPage()
  return page
}
async function settle(page) {
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(1, 1)
  await page.waitForTimeout(400)
}
async function record(page, m, name, opts = {}) {
  await settle(page)
  if (opts.blur) { await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); await page.waitForTimeout(500) }
  const data = await page.evaluate(measure)
  await page.screenshot({ path: shot(m, name), fullPage: !!opts.full })
  results.states.push({ milestone: m, name, viewport: page.viewportSize(), ...data })
  console.log(`ok ${name}`)
}
async function gotoHosts(page) {
  await page.goto(`${BASE}/hosts`)
  await page.locator("main table tbody tr [data-status]").first().waitFor()
}
const selectTwo = async (page) => {
  const boxes = page.locator("main table tbody tr").getByRole("checkbox")
  await boxes.nth(0).click(); await boxes.nth(1).click()
  await page.getByRole("toolbar", { name: "Aksi untuk host terpilih" }).waitFor()
}
const openEdit = async (page, name = "storage-01") => {
  await page.getByRole("button", { name: `Aksi untuk ${name}` }).click()
  await record(page, 2, "hosts-row-menu", { blur: false })
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: `Konfigurasi ${name}` })
  await sheet.waitFor()
  return sheet
}

try {
  // ===== M1: layout, /design, placeholder =====
  let page = await newPage()
  await gotoHosts(page)
  await record(page, 1, "hosts-default")
  results.states.at(-1).alsoM2 = true
  await page.goto(`${BASE}/design`); await record(page, 1, "design", { full: true })
  for (const p of ["os-images", "ssh-keys", "jobs", "settings"]) { await page.goto(`${BASE}/${p}`); await record(page, 1, `placeholder-${p}`) }
  await page.goto(`${BASE}/hosts`); await page.locator("main table tbody tr [data-status]").first().waitFor()
  await page.keyboard.press("Control+k"); await page.getByRole("dialog").waitFor(); await record(page, 1, "command-dialog")
  await page.keyboard.press("Escape")

  // ===== M2: tabel host, bulk bar =====
  await gotoHosts(page)
  await selectTwo(page)
  await record(page, 2, "hosts-bulk-bar")

  // ===== M3: sheet single, tiap tab =====
  await gotoHosts(page)
  const sheet = await openEdit(page)
  for (const tab of ["OS", "Credentials", "Network", "Hostname", "SSH Keys"]) {
    await sheet.getByRole("tab", { name: new RegExp(`^${tab}`) }).click()
    if (tab === "Network") { const st = sheet.getByRole("radio", { name: /static/i }); if (await st.count()) await st.first().click() }
    await record(page, 3, `sheet-single-${tab.toLowerCase().replace(" ", "-")}`, { blur: true })
  }
  await page.keyboard.press("Escape")

  // install dialog (ctrl-02) — ditutup Batal, tanpa install
  await gotoHosts(page)
  await page.getByRole("button", { name: "Aksi untuk ctrl-02" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const s2 = page.getByRole("dialog", { name: "Konfigurasi ctrl-02" })
  await s2.locator("#os-disk").fill("/dev/sda")
  await s2.getByRole("button", { name: "Simpan & Install" }).click()
  const confirm = page.getByRole("alertdialog")
  await confirm.waitFor()
  await record(page, 3, "install-confirm", { blur: true })
  await confirm.getByRole("button", { name: "Batal" }).click()
  await page.keyboard.press("Escape")

  // bulk: Network + Hostname preview
  await gotoHosts(page)
  await selectTwo(page)
  const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
  await bar.getByRole("button", { name: "Set IP" }).click()
  const bs = page.getByRole("dialog", { name: /^Konfigurasi 2 host/ })
  await bs.waitFor()
  await bs.getByRole("table", { name: "Preview IP baru" }).waitFor()
  await record(page, 3, "sheet-bulk-network", { blur: true })
  await bs.getByRole("tab", { name: /^Hostname/ }).click()
  await bs.getByRole("table", { name: "Preview Hostname baru" }).waitFor()
  await record(page, 3, "sheet-bulk-hostname", { blur: true })
  await page.keyboard.press("Escape")
  await page.context().close()

  // ===== iter2: state baru =====
  // M2 empty state (stub /api/hosts kosong) — CIDR dari /api/network harus mono
  await page.context().close()
  page = await newPage()
  await page.route("**/api/hosts", (r) => r.request().method() === "GET"
    ? r.fulfill({ json: { hosts: [], serverTime: new Date().toISOString() } }) : r.continue())
  await page.goto(`${BASE}/hosts`)
  await page.getByText("Belum ada host").waitFor()
  await page.waitForTimeout(500)
  await record(page, 2, "hosts-empty", { blur: true })
  await page.unrouteAll({ behavior: "ignoreErrors" })

  // M3 error state Sheet (stub GET config 500)
  await page.route("**/api/hosts/*/config", (r) => r.request().method() === "GET"
    ? r.fulfill({ status: 500, json: { error: "Simulasi gagal (design audit)" } }) : r.continue())
  await gotoHosts(page)
  await page.getByRole("button", { name: "Aksi untuk storage-01" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  await page.getByRole("dialog", { name: "Konfigurasi storage-01" }).getByText("Gagal memuat konfigurasi host").waitFor({ timeout: 15000 })
  await record(page, 3, "sheet-error", { blur: true })
  await page.keyboard.press("Escape")
  await page.unrouteAll({ behavior: "ignoreErrors" })

  // M3 dialog password acak (stub POST /api/hosts/bulk dengan password dummy)
  await page.route("**/api/hosts/bulk", async (r) => {
    if (r.request().method() !== "POST") return r.continue()
    const body = r.request().postDataJSON()
    const hosts = (await (await page.request.get(`${BASE}/api/hosts`)).json()).hosts
    const pw = body.hostIds.map((id, i) => { const h = hosts.find((x) => x.id === id); return { mac: h?.mac ?? "52:54:00:00:00:0" + i, hostname: h?.hostname ?? null, username: "ubuntu", password: `DUMMY-audit-${i}xxxxx` } })
    return r.fulfill({ json: { updated: body.hostIds.length, generatedPasswords: pw } })
  })
  await gotoHosts(page)
  await selectTwo(page)
  await page.getByRole("toolbar", { name: "Aksi untuk host terpilih" }).getByRole("button", { name: "Set Credentials" }).click()
  const cs = page.getByRole("dialog", { name: /^Konfigurasi 2 host/ }); await cs.waitFor()
  await cs.getByRole("radio", { name: "Password acak per host" }).click()
  const user = cs.locator("#cred-user"); if (await user.count() && !(await user.inputValue())) await user.fill("ubuntu")
  await cs.getByRole("button", { name: "Simpan konfigurasi" }).click()
  const pd = page.getByRole("dialog", { name: "Password acak dibuat" }); await pd.waitFor()
  await record(page, 3, "passwords-dialog", { blur: true })
  await pd.getByRole("checkbox", { name: "Saya sudah menyimpan password" }).click()
  await record(page, 3, "passwords-dialog-confirmed", { blur: true })
  await pd.getByRole("button", { name: "Selesai" }).click()
  await page.unrouteAll({ behavior: "ignoreErrors" })

  // ===== 375px =====
  page = await newPage(375, 812)
  await gotoHosts(page); await record(page, 1, "mobile-hosts")
  await selectTwo(page); await record(page, 2, "mobile-hosts-bulk-bar")
  await page.goto(`${BASE}/design`); await record(page, 1, "mobile-design", { full: true })
  for (const p of ["os-images", "settings"]) { await page.goto(`${BASE}/${p}`); await record(page, 1, `mobile-placeholder-${p}`) }
  await gotoHosts(page)
  const ms = await (async () => {
    await page.getByRole("button", { name: "Aksi untuk storage-01" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const s = page.getByRole("dialog", { name: "Konfigurasi storage-01" }); await s.waitFor(); return s
  })()
  await record(page, 3, "mobile-sheet-os", { blur: true })
  await ms.getByRole("tab", { name: /^Network/ }).click(); await record(page, 3, "mobile-sheet-network", { blur: true })
  await page.context().close()
} catch (e) {
  results.error = String(e?.stack ?? e)
  console.error(e)
} finally {
  await browser.close()
  for (const m of [1, 2, 3]) {
    const states = results.states.filter((s) => s.milestone === m || (m === 2 && s.alsoM2))
    writeFileSync(path.join(outDir(m), "audit-results.json"), JSON.stringify({ ...results, states }, null, 2))
  }
  writeFileSync(path.join(outDir(1), "audit-results-all.json"), JSON.stringify(results, null, 2))
}
