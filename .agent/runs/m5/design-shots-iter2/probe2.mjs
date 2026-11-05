import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
const DASH = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard"
const require = createRequire(path.join(DASH, "package.json"))
const { chromium } = require("playwright")
const OUT = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m5/design-shots-iter2"
const B = "http://localhost:3260"
const src = readFileSync("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m4/design/audit.mjs", "utf8")
const measureSrc = src.slice(src.indexOf("function measure() {"), src.indexOf("\nconst results"))
const a5 = readFileSync("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m5/design-shots/audit.mjs", "utf8")
const extraSrc = eval(a5.slice(a5.indexOf("const extra = `") + 14, a5.indexOf("}`\n") + 2))
const generic = `() => {
  const t = document.body.innerText
  const ms = [...t.matchAll(/\\bM[0-9]\\b|tahap [0-9]|generator M/g)].map(m => t.slice(Math.max(0,m.index-30), m.index+30))
  const h1 = document.querySelector("h1"); const hs = h1 ? getComputedStyle(h1) : null
  return { bodyBg: getComputedStyle(document.body).backgroundColor, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight,
    h1: hs && { text: h1.innerText, fs: hs.fontSize, fw: hs.fontWeight, ls: hs.letterSpacing, ff: hs.fontFamily.slice(0,40) }, milestoneRefs: ms }
}`
// DR-5-1 path checks
const osProbe = `() => {
  const rows = [...document.querySelectorAll("tbody tr")].filter(r => r.querySelector("[data-testid=img-source]"))
  return rows.map(r => {
    const rr = r.getBoundingClientRect()
    const src = r.querySelector("[data-testid=img-source]")
    const paths = [...src.querySelectorAll("span.type-data")].map(p => {
      const segs = [...p.children]
      const lines = new Set(segs.flatMap(s => [...s.getClientRects()].map(x => Math.round(x.top))))
      const brokenSegs = segs.filter(s => s.getClientRects().length > 1 || s.getBoundingClientRect().height > parseFloat(getComputedStyle(s).lineHeight) * 1.5).map(s => ({ text: s.textContent, w: Math.round(s.getBoundingClientRect().width), h: Math.round(s.getBoundingClientRect().height), container: Math.round(p.parentElement.getBoundingClientRect().width) }))
      const right = Math.max(...segs.map(s=>s.getBoundingClientRect().right))
      return { text: p.textContent, lines: lines.size, brokenSegs, mono: getComputedStyle(p).fontFamily.startsWith('"JetBrains Mono'), overflowRight: right > p.parentElement.getBoundingClientRect().right + 0.5 }
    })
    const reason = r.querySelector("[data-available=false]")
    let reasonInfo = null
    if (reason) { const rb = reason.getBoundingClientRect(); reasonInfo = { text: reason.innerText.slice(0,120), w: Math.round(rb.width), h: Math.round(rb.height), right: Math.round(rb.right), sw: reason.scrollWidth, cw: reason.clientWidth, ff: getComputedStyle(reason).fontFamily.slice(0,30) } }
    return { id: r.innerText.split("\\n")[0], h: Math.round(rr.height), w: Math.round(rr.width), right: Math.round(rr.right), srcW: Math.round(src.getBoundingClientRect().width), display: getComputedStyle(r).display, paths, reason: reasonInfo }
  })
}`
const tableProbe = `() => [...document.querySelectorAll("[data-slot=table-container], table")].map(t => ({ tag: t.tagName, sw: t.scrollWidth, cw: t.clientWidth, w: Math.round(t.getBoundingClientRect().width), right: Math.round(t.getBoundingClientRect().right), headers: [...t.querySelectorAll("th")].filter(th => getComputedStyle(th).display !== "none").map(th => th.innerText.trim()) }))`
const results = { at: new Date().toISOString(), states: [] }
const browser = await chromium.launch()
async function newPage(w = 1440, h = 900) { const c = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", locale: "id-ID" }); return c.newPage() }
async function record(page, name, opts = {}) {
  await page.evaluate(() => document.fonts.ready)
  if (!opts.keepMouse) await page.mouse.move(1, 1)
  await page.waitForTimeout(opts.wait ?? 700)
  const data = {}
  data.generic = await page.evaluate(`(${generic})()`)
  if (opts.extra) data.extra = await page.evaluate(`(${opts.extra})()`)
  await page.screenshot({ path: path.join(OUT, `probe-${name}.png`), fullPage: !!opts.full })
  results.states.push({ name, viewport: page.viewportSize(), ...data })
  console.log(`ok ${name}`)
}
const rowByMac = (page, mac) => page.locator("tr", { has: page.getByText(mac, { exact: true }) })
async function openSheet(page, mac, item = "Edit konfigurasi") {
  await rowByMac(page, mac).getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: item }).click()
  const s = page.getByRole("dialog", { name: /^Konfigurasi / }); await s.waitFor(); return s
}
const jobs = (await (await fetch(B + "/api/jobs")).json()).jobs
const jobOf = (hid, st) => jobs.find((j) => j.hostId === hid && (!st || j.status === st))
const A = "525400990061", Bh = "525400990062", D = "525400990064"
const jobRowProbe = `() => { const r = document.querySelector("tr[data-state=selected]"); if (!r) return null; const cs = getComputedStyle(r); const td = r.querySelector("td"); return { bg: cs.backgroundColor, borderLeft: getComputedStyle(td).borderLeftColor + " " + getComputedStyle(td).borderLeftWidth, texts: [...r.querySelectorAll("*")].filter(e => [...e.childNodes].some(n => n.nodeType===3 && n.textContent.trim())).map(e => ({ t: e.innerText.trim().slice(0,40), c: getComputedStyle(e).color, ff: getComputedStyle(e).fontFamily.slice(0,16) })) } }`
try {
  for (const [w, h, pre] of [[1440, 900, ""], [1280, 800, "w1280-"], [375, 812, "mobile-"]]) {
    const page = await newPage(w, h)
    await page.goto(B + "/os-images"); await page.getByTestId("os-images-page").waitFor(); await page.waitForTimeout(800); await record(page, pre + "os-images", { full: true, extra: osProbe })
    await page.goto(B + "/ssh-keys"); await page.waitForTimeout(800); await record(page, pre + "ssh-keys", { full: true, extra: tableProbe })
    if (pre === "w1280-") continue
    await page.goto(B + "/jobs"); await page.getByTestId("jobs-page").waitFor(); await page.waitForTimeout(800); await record(page, pre + "jobs-list", { full: true })
    await page.goto(B + `/jobs?host=${A}`); await page.waitForTimeout(800); await record(page, pre + "jobs-history-done", { full: true, extra: jobRowProbe })
    await page.goto(B + `/jobs?job=${jobOf(Bh).id}`); await page.waitForTimeout(800); await record(page, pre + "jobs-failed-callback", { full: true, extra: jobRowProbe })
    await page.goto(B + `/jobs?job=${jobOf(D).id}`); await page.waitForTimeout(1500); await record(page, pre + "jobs-live-log", { full: true })
    await page.goto(B + "/hosts"); await page.waitForTimeout(800); await record(page, pre + "hosts", { full: true })
    await page.goto(B + "/settings"); await page.waitForTimeout(800); await record(page, pre + "settings", { full: true })
  }
  const dialogProbe = `() => { const d = document.querySelector("[role=dialog]"); const f = document.querySelector("[data-testid=img-dialog-footer]"); const btns = f ? [...f.querySelectorAll("button")].map(b => { const r = b.getBoundingClientRect(); return { t: b.innerText.trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), inViewport: r.top >= 0 && r.bottom <= innerHeight } }) : []
    const errs = [...d.querySelectorAll("[data-slot=field-error], [role=alert]")].map(e => e.innerText.trim())
    const hints = [...d.querySelectorAll("[data-slot=field-description]")].map(e => e.innerText.trim().slice(0,60))
    const db = d.getBoundingClientRect(); return { dialog: { top: Math.round(db.top), h: Math.round(db.height), sh: d.scrollHeight, ch: d.clientHeight }, footer: f && { bg: getComputedStyle(f).backgroundColor, pos: getComputedStyle(f).position }, btns, errs, hints } }`
  for (const [w, h, pre] of [[1440, 900, ""], [375, 812, "mobile-"]]) {
    const page = await newPage(w, h)
    await page.goto(B + "/os-images"); await page.waitForTimeout(600)
    await page.getByRole("button", { name: "Daftarkan image" }).first().click(); await page.getByRole("dialog").waitFor(); await record(page, pre + "os-register-dialog", { extra: dialogProbe })
    const dlg = page.getByRole("dialog"); await dlg.getByTestId("img-dialog-footer").getByRole("button", { name: /Daftarkan/ }).click(); await page.waitForTimeout(900); await record(page, pre + "os-register-errors", { extra: dialogProbe })
    await page.screenshot({ path: path.join(OUT, `${pre}os-register-errors-full-dialog.png`), fullPage: true })
    // isi invalid: path absolut + id huruf besar, version terlalu panjang
    const tb = dlg.locator("input")
    const n = await tb.count(); console.log("inputs", n)
    await dlg.evaluate((d) => { d.scrollTop = 0 })
    if (pre === "") {
      for (let i = 0; i < n; i++) { const el = tb.nth(i); const id = await el.getAttribute("id"); console.log("input", id) }
    }
  }
  const page = await newPage()
  await page.goto(B + "/os-images"); await page.waitForTimeout(600)
  await page.getByRole("button", { name: "Daftarkan image" }).first().click(); const dlg = page.getByRole("dialog"); await dlg.waitFor()
  const inputs = dlg.locator("input[type=text], input:not([type])")
  const vals = ["Ubuntu-Huruf-Besar", "x", "v".repeat(40)]
  for (let i = 0; i < Math.min(3, await inputs.count()); i++) await inputs.nth(i).fill(vals[i])
  const repo = dlg.locator("input").filter({ hasNot: page.locator("x") })
  const all = await dlg.locator("input").all()
  for (const el of all) { const id = (await el.getAttribute("id")) ?? ""; if (/kernel/.test(id)) await el.fill("/abs/vmlinuz"); if (/repo/.test(id)) await el.fill("../luar") }
  await dlg.getByTestId("img-dialog-footer").getByRole("button", { name: /Daftarkan/ }).click(); await page.waitForTimeout(900); await record(page, "os-register-errors-invalid", { extra: dialogProbe })
  await page.keyboard.press("Escape"); await page.waitForTimeout(400)
  // delete confirm (I-5-3 title) dan 409
  await page.locator("tr", { hasText: "ubuntu-24.04" }).first().getByRole("button").last().click(); await page.waitForTimeout(500); await record(page, "os-delete-confirm")
  await page.getByRole("alertdialog").getByRole("button").last().click(); await page.waitForTimeout(800); await record(page, "os-delete-409")
  await page.keyboard.press("Escape"); await page.waitForTimeout(400)
  // DR-5-3: install single rejected (D masih installing) + bulk partial
  await page.goto(B + "/hosts"); await page.waitForTimeout(800)
  const alertProbe = `() => [...document.querySelectorAll("[data-slot=install-error-item]")].map(li => ({ text: li.innerText, monoSpans: [...li.querySelectorAll("*")].filter(e => getComputedStyle(e).fontFamily.startsWith('"JetBrains Mono')).map(e => e.innerText), liFont: getComputedStyle(li).fontFamily.slice(0,20) }))`
  let s = await openSheet(page, "52:54:00:99:00:64")
  await s.getByRole("button", { name: /^(Simpan & Install|Install)$/ }).click(); await page.getByRole("alertdialog").getByRole("button", { name: "Hapus disk & install" }).click(); await page.waitForTimeout(1500); await record(page, "install-rejected-single", { extra: alertProbe })
  await page.keyboard.press("Escape"); await page.waitForTimeout(400)
  for (const mac of ["52:54:00:99:00:61", "52:54:00:99:00:64"]) await rowByMac(page, mac).getByRole("checkbox").click()
  await page.getByRole("toolbar", { name: "Aksi untuk host terpilih" }).getByRole("button", { name: "Install OS" }).click()
  s = page.getByRole("dialog", { name: /Konfigurasi 2 host/ }); await s.waitFor(); await record(page, "bulk-sheet-os")
  await s.locator('[id="os-ubuntu-24.04"]').click()
  await s.getByRole("button", { name: "Simpan & Install" }).click(); await page.getByRole("alertdialog").getByRole("button", { name: "Hapus disk & install" }).click(); await page.waitForTimeout(1500); await record(page, "bulk-partial", { extra: alertProbe })
  // sheet OS tab: cek kartu image tidak tersedia (DR-5-4)
  await page.keyboard.press("Escape"); await page.waitForTimeout(400)
  await page.goto(B + "/hosts"); await page.waitForTimeout(800)
  s = await openSheet(page, "52:54:00:99:00:62"); await s.getByRole("tab", { name: /OS/ }).click(); await page.waitForTimeout(500); await record(page, "sheet-os-tab")
  const m = await newPage(375, 812)
  await m.goto(B + "/hosts"); await m.waitForTimeout(800)
  s = await openSheet(m, "52:54:00:99:00:62"); await s.getByRole("tab", { name: /OS/ }).click(); await m.waitForTimeout(500); await record(m, "mobile-sheet-os-tab")
} catch (e) { console.error("ERR", e.message.slice(0, 800)) }
writeFileSync(path.join(OUT, "probe-results.json"), JSON.stringify(results, null, 1))
await browser.close()
