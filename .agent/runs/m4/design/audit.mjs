// Design audit read-only M4 (design-reviewer). Jalankan dari dashboard/:
//   node ../.agent/runs/m4/design/audit.mjs   (server: next start -p 3250, DB tmp .e2e-data/design-iter1)
// Mutasi (install/hapus) di-stub via page.route di browser; server tidak dimutasi.
// measure() disalin dari m1/design/audit.mjs (iter3).
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(path.join(process.cwd(), "package.json"))
const { chromium } = require("playwright")
const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.BASE_URL ?? "http://localhost:3250"
const OUT = path.resolve(HERE, "../screenshots/design-iter1")
mkdirSync(OUT, { recursive: true })

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
  const toasts = Array.from(document.querySelectorAll("[data-sonner-toast]")).filter(vis).map((el) => {
    const cs = getComputedStyle(el)
    return { ...desc(el), type: el.dataset.type ?? null, expanded: el.dataset.expanded ?? null, hovered: el.matches(":hover"), focusVisible: el.matches(":focus-visible"),
      boxShadow: cs.boxShadow, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily, fontSize: cs.fontSize,
      descColor: (() => { const d = el.querySelector("[data-description]"); return d ? getComputedStyle(d).color : null })(),
      iconColor: (() => { const d = el.querySelector("[data-icon]"); return d ? getComputedStyle(d).color : null })() }
  })
  return { toasts, sidebarIp, checkboxes, alerts, url: location.pathname + location.search, bodyBg: body.backgroundColor, bodyColor: body.color, htmlFont: getComputedStyle(document.documentElement).fontFamily, title, headerH, th, shadows, orange, pastel, pills, tech, shapes, overflow }
}


const results = { base: BASE, at: new Date().toISOString(), states: [] }
const browser = await chromium.launch()
async function newPage(width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", locale: "id-ID" })
  return ctx.newPage()
}
async function record(page, name, opts = {}) {
  await page.evaluate(() => document.fonts.ready)
  if (!opts.keepMouse) await page.mouse.move(1, 1)
  await page.waitForTimeout(500)
  const data = await page.evaluate(measure)
  if (opts.extra) data.extra = await page.evaluate(opts.extra)
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !!opts.full })
  results.states.push({ name, viewport: page.viewportSize(), ...data })
  console.log(`ok ${name}`)
}
async function gotoHosts(page) {
  await page.goto(`${BASE}/hosts`)
  await page.locator("main table tbody tr [data-status]").first().waitFor()
}
const statusExtra = () => Array.from(document.querySelectorAll("[data-service]")).map((el) => {
  const cs = getComputedStyle(el); const dot = el.querySelector("[data-slot=status-dot]"); const lab = el.querySelector(".type-data")
  return { service: el.dataset.service, state: el.dataset.state, bg: cs.backgroundColor, border: cs.borderTopColor, radius: cs.borderTopLeftRadius, h: el.getBoundingClientRect().height, dot: dot && getComputedStyle(dot).backgroundColor, labelFont: lab && getComputedStyle(lab).fontFamily, labelSize: lab && getComputedStyle(lab).fontSize }
})
const tooltipExtra = () => Array.from(document.querySelectorAll("[data-slot=tooltip-content]")).map((el) => {
  const cs = getComputedStyle(el)
  return { text: el.innerText, bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, boxShadow: cs.boxShadow, font: cs.fontFamily, spans: Array.from(el.querySelectorAll("span")).map((s) => ({ t: s.innerText, font: getComputedStyle(s).fontFamily, size: getComputedStyle(s).fontSize })) }
})
const toastExtra = () => Array.from(document.querySelectorAll("[data-sonner-toast]")).map((el) => ({
  title: el.querySelector("[data-title]")?.innerText, titleFont: el.querySelector("[data-title]") && getComputedStyle(el.querySelector("[data-title]")).fontFamily,
  dataSpans: Array.from(el.querySelectorAll(".type-data")).map((s) => ({ t: s.innerText, font: getComputedStyle(s).fontFamily })),
  descColor: el.querySelector("[data-description]") && getComputedStyle(el.querySelector("[data-description]")).color,
}))
const settingsExtra = () => {
  const cards = Array.from(document.querySelectorAll("main [data-slot=settings-section]")).map((c) => ({ title: c.querySelector("[data-slot=card-title]")?.innerText, titleSize: c.querySelector("[data-slot=card-title]") && getComputedStyle(c.querySelector("[data-slot=card-title]")).fontSize, titleWeight: c.querySelector("[data-slot=card-title]") && getComputedStyle(c.querySelector("[data-slot=card-title]")).fontWeight, w: c.getBoundingClientRect().width, radius: getComputedStyle(c).borderTopLeftRadius }))
  const dds = Array.from(document.querySelectorAll("main dd, main dt")).map((e) => ({ tag: e.tagName, t: e.innerText.trim().slice(0, 50), font: getComputedStyle(e).fontFamily.slice(0, 20), size: getComputedStyle(e).fontSize, color: getComputedStyle(e).color }))
  const main = document.querySelector("main"); const mcs = main && getComputedStyle(main)
  return { cards, dds, mainPad: mcs && [mcs.paddingTop, mcs.paddingLeft].join(" "), mainW: main?.getBoundingClientRect().width }
}
const menuExtra = () => Array.from(document.querySelectorAll("[data-slot=dropdown-menu-item]")).map((el) => ({ t: el.innerText.replace(/\s+/g, " ").trim(), disabled: el.hasAttribute("data-disabled"), opacity: getComputedStyle(el).opacity, color: getComputedStyle(el).color, h: el.getBoundingClientRect().height }))
const osExtra = () => ({
  cards: Array.from(document.querySelectorAll("[data-available]")).map((el) => ({ t: el.innerText.replace(/\s+/g, " ").slice(0, 80), available: el.dataset.available, bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor, opacity: getComputedStyle(el).opacity, radius: getComputedStyle(el).borderTopLeftRadius, notes: Array.from(el.querySelectorAll("[id$=-note]")).map((n) => ({ t: n.innerText, color: getComputedStyle(n).color })) })),
  blocked: (() => { const p = document.getElementById("install-blocked"); return p && { t: p.innerText, color: getComputedStyle(p).color, size: getComputedStyle(p).fontSize } })(),
  primary: Array.from(document.querySelectorAll("[data-slot=sheet-content] [data-slot=button][data-variant=default]")).map((b) => ({ t: b.innerText, disabled: b.disabled, bg: getComputedStyle(b).backgroundColor, opacity: getComputedStyle(b).opacity })),
  sheetTitle: (() => { const t = document.querySelector("[data-slot=sheet-title]"); return t && { t: t.innerText, font: getComputedStyle(t).fontFamily, size: getComputedStyle(t).fontSize, weight: getComputedStyle(t).fontWeight, inner: Array.from(t.querySelectorAll("*")).map((s) => ({ t: s.innerText, font: getComputedStyle(s).fontFamily.slice(0, 20) })) } })(),
  installErr: (() => { const a = document.querySelector("[data-slot=install-errors]"); return a && { t: a.innerText, bg: getComputedStyle(a).backgroundColor, color: getComputedStyle(a).color, border: getComputedStyle(a).borderTopColor, radius: getComputedStyle(a).borderTopLeftRadius, data: Array.from(a.querySelectorAll(".type-data")).map((s) => ({ t: s.innerText, font: getComputedStyle(s).fontFamily.slice(0, 20) })) } })(),
})

try {
  const hostsJson = await (await fetch(`${BASE}/api/hosts`)).json()
  const hostsList = Array.isArray(hostsJson) ? hostsJson : hostsJson.hosts ?? hostsJson.data ?? []
  const byName = (n) => hostsList.find((h) => h.hostname === n)
  results.hostsCount = hostsList.length

  // 1. Hosts, status server nyata
  let page = await newPage()
  await gotoHosts(page)
  await page.locator("[data-service]").first().waitFor()
  await page.waitForTimeout(800)
  await record(page, "hosts-real-status", { extra: statusExtra })
  await page.locator("[data-service=TFTP]").hover(); await page.waitForTimeout(600)
  await record(page, "topbar-tooltip-real", { keepMouse: true, extra: tooltipExtra })

  // 2. Status server di-stub campuran
  await page.route("**/api/server-status", (r) => r.fulfill({ json: { checkedAt: new Date().toISOString(), services: [
    { name: "DHCP", state: "online", online: true, detail: "dnsmasq pid 812 hidup" },
    { name: "TFTP", state: "offline", online: false, detail: "file hilang di /srv/pxe/tftp: undionly.kpxe" },
    { name: "HTTP", state: "unknown", online: false, detail: "PXE_HTTP_PIDFILE tidak diset" } ] } }))
  await gotoHosts(page); await page.waitForTimeout(800)
  await record(page, "topbar-mixed", { extra: statusExtra })
  await page.locator("[data-service=TFTP]").hover(); await page.waitForTimeout(600)
  await record(page, "topbar-mixed-tooltip", { keepMouse: true, extra: tooltipExtra })
  await page.unroute("**/api/server-status")

  // 3. Settings
  await page.goto(`${BASE}/settings`); await page.locator("main [data-slot=settings-section]").first().waitFor()
  await record(page, "settings", { full: true, extra: settingsExtra })

  // 4. Menu baris: reboot nonaktif
  await gotoHosts(page)
  await page.getByRole("button", { name: "Aksi untuk storage-01" }).click()
  await page.locator("[data-slot=dropdown-menu-content]").waitFor()
  await record(page, "row-menu-reboot-disabled", { keepMouse: true, extra: menuExtra })
  await page.keyboard.press("Escape")

  // 5. Sheet single: OS tab, Windows (blocked), Network
  await page.getByRole("button", { name: "Aksi untuk storage-01" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: /Konfigurasi storage-01/ })
  await sheet.waitFor(); await page.waitForTimeout(800)
  await record(page, "sheet-os-tab", { extra: osExtra })
  const win = page.locator("[data-available] >> text=Windows").first()
  if (await win.count()) { await win.click({ force: true }).catch(() => {}); await page.waitForTimeout(400) }
  await record(page, "sheet-os-windows", { extra: osExtra })
  // pilih ulang Ubuntu 24.04 (tersedia)
  await page.locator("[data-available=true] >> text=Ubuntu Server 24.04").first().click().catch(() => {})
  await sheet.getByRole("tab", { name: "Network" }).click(); await page.waitForTimeout(400)
  await record(page, "sheet-network-tab", { extra: osExtra })

  // 6. Install error per host (single) — stub install
  const st = byName("storage-01")
  await page.route("**/api/hosts/*/install", (r) => r.fulfill({ json: { started: [], failed: [{ hostId: st?.id ?? "x", message: "media rocky-9 tidak tersedia di server" }] } }))
  await sheet.getByRole("tab", { name: /^OS/ }).click()
  const installBtn = sheet.getByRole("button", { name: /^(Simpan & )?Install$/ })
  await installBtn.click()
  await page.locator("[data-slot=alert-dialog-content]").waitFor()
  await record(page, "install-confirm-dialog", { keepMouse: true })
  await page.locator("[data-slot=alert-dialog-action]").click()
  await page.locator("[data-slot=install-errors]").waitFor({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(600)
  await record(page, "install-error-single", { extra: osExtra })
  ;results.states.at(-1).toastExtra = await page.evaluate(toastExtra)
  await page.unroute("**/api/hosts/*/install")
  await page.keyboard.press("Escape"); await page.waitForTimeout(400)

  // 7. Bulk install error per host
  page = await newPage()
  await gotoHosts(page)
  const boxes = page.locator("main table tbody tr").getByRole("checkbox")
  await boxes.nth(0).click(); await boxes.nth(1).click(); await boxes.nth(2).click()
  const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
  await bar.waitFor()
  const ids = await page.evaluate(async () => (await (await fetch("/api/hosts")).json()))
  const list = Array.isArray(ids) ? ids : ids.hosts ?? []
  await page.route("**/api/hosts/bulk/install", async (r) => {
    const body = r.request().postDataJSON?.() ?? {}
    const hostIds = body.hostIds ?? body.ids ?? list.slice(0, 3).map((h) => h.id)
    r.fulfill({ json: { started: [hostIds[0]], failed: hostIds.slice(1).map((id, i) => ({ hostId: id, message: i ? "IP statis 10.99.0.21 sudah dipakai host lain" : "job aktif sudah ada" })) } })
  })
  await bar.getByRole("button", { name: "Install OS" }).click()
  const bsheet = page.locator("[data-slot=sheet-content]"); await bsheet.waitFor(); await page.waitForTimeout(600)
  await record(page, "bulk-sheet-os", { extra: osExtra })
  await page.locator("[data-available=true] >> text=Ubuntu Server 24.04").first().click().catch(() => {})
  await bsheet.locator("[data-slot=sheet-footer] [data-slot=button][data-variant=default]").click().catch(() => {})
  await page.locator("[data-slot=alert-dialog-content]").waitFor({ timeout: 3000 }).catch(() => {})
  if (await page.locator("[data-slot=alert-dialog-action]").count()) await page.locator("[data-slot=alert-dialog-action]").click()
  await page.locator("[data-slot=install-errors]").waitFor({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(600)
  await record(page, "install-error-bulk", { extra: osExtra })
  results.states.at(-1).toastExtra = await page.evaluate(toastExtra)

  // 8. Toast hapus (DR-2-3) — DELETE di-stub
  page = await newPage()
  await page.route(/\/api\/hosts\/[^/]+$/, (r) => r.request().method() === "DELETE" ? r.fulfill({ status: 204, body: "" }) : r.continue())
  await gotoHosts(page)
  await page.getByRole("button", { name: "Aksi untuk storage-01" }).click()
  await page.getByRole("menuitem", { name: /Hapus/ }).click()
  await page.locator("[data-slot=alert-dialog-action]").click()
  await page.locator("[data-sonner-toast]").first().waitFor({ timeout: 5000 }).catch(() => {})
  await record(page, "toast-delete", {})
  results.states.at(-1).toastExtra = await page.evaluate(toastExtra)

  // 9. Placeholder
  for (const p of ["os-images", "ssh-keys", "jobs"]) { await page.goto(`${BASE}/${p}`); await record(page, `placeholder-${p}`) }

  // 10. Mobile
  page = await newPage(375, 812)
  await gotoHosts(page); await record(page, "mobile-hosts", { extra: statusExtra })
  await page.goto(`${BASE}/settings`); await page.locator("main [data-slot=settings-section]").first().waitFor()
  await record(page, "mobile-settings", { full: true, extra: settingsExtra })
} catch (e) {
  console.error("AUDIT ERROR", e)
  results.error = String(e?.stack ?? e)
} finally {
  writeFileSync(path.join(OUT, "audit-results.json"), JSON.stringify(results, null, 2))
  await browser.close()
}
