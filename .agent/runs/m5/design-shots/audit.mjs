import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
const DASH = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard"
const require = createRequire(path.join(DASH, "package.json"))
const { chromium } = require("playwright")
const OUT = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m5/design-shots"
const B = "http://localhost:3260"
const src = readFileSync("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m4/design/audit.mjs", "utf8")
const measureSrc = src.slice(src.indexOf("function measure() {"), src.indexOf("\nconst results"))
// tambahan M5: data teknis waktu/seq/job id/durasi + kontras teks
const extra = `function extraM5() {
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const all = Array.from(document.querySelectorAll("body *")).filter(vis)
  const leafs = all.filter((el) => !(el instanceof SVGElement) && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()))
  const RX = { time: /^\\d{2}[:.]\\d{2}[:.]\\d{2}$/, dur: /^\\d+ (dtk|mnt|jam)( \\d+ (dtk|mnt))?$/, jobid: /^job-[0-9a-f-]{8,}/, osid: /^(ubuntu|debian|rocky|windows)-[0-9.]+$/, frac: /^\\d+\\/\\d+$/, path: /^(\\/|https?:\\/\\/)\\S+$/, fp: /^SHA256:/, mac: /([0-9a-f]{2}:){5}[0-9a-f]{2}/i, ip: /\\b(\\d{1,3}\\.){3}\\d{1,3}\\b/ }
  const tech = []
  for (const el of leafs) {
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim()
    for (const [k, rx] of Object.entries(RX)) if (rx.test(own)) { const f = getComputedStyle(el).fontFamily; tech.push({ kind: k, text: own.slice(0, 70), tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 90), mono: f.startsWith('"JetBrains Mono') }); break }
  }
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const lowContrast = []
  for (const el of leafs) {
    let opacity = 1, bg = null
    for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); opacity *= Number(cs.opacity); const c = parse(cs.backgroundColor); if (!bg && c && c.a > 0.99) bg = c }
    const fg = parse(getComputedStyle(el).color); if (!fg) continue
    const back = bg ?? { r: 247, g: 247, b: 244 }
    const a = fg.a * opacity
    const bl = { r: fg.r * a + back.r * (1 - a), g: fg.g * a + back.g * (1 - a), b: fg.b * a + back.b * (1 - a) }
    const l1 = lum(bl), l2 = lum(back); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (ratio < 4.5 && !el.closest("[aria-hidden=true],[data-disabled],:disabled,[data-status]"))
      lowContrast.push({ text: el.innerText.trim().slice(0, 50), ratio: Math.round(ratio * 100) / 100, color: getComputedStyle(el).color, bg: back ? \`rgb(\${back.r}, \${back.g}, \${back.b})\` : null, fontSize: fs, opacity })
  }
  return { tech, lowContrast }
}`
const results = { at: new Date().toISOString(), states: [] }
const browser = await chromium.launch()
const ctxs = []
async function newPage(w = 1440, h = 900) { const c = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", locale: "id-ID" }); ctxs.push(c); return c.newPage() }
async function record(page, name, opts = {}) {
  await page.evaluate(() => document.fonts.ready)
  if (!opts.keepMouse) await page.mouse.move(1, 1)
  await page.waitForTimeout(opts.wait ?? 700)
  const data = await page.evaluate(`(${measureSrc})()`)
  data.m5 = await page.evaluate(`(${extra})()`)
  if (opts.extra) data.extra = await page.evaluate(opts.extra)
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !!opts.full })
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
const A = "525400990061", Bh = "525400990062", C = "525400990063", D = "525400990064"
try {
  for (const [w, h, pre] of [[1440, 900, ""], [375, 812, "mobile-"]]) {
    const page = await newPage(w, h)
    await page.goto(B + "/jobs"); await page.getByTestId("jobs-page").waitFor(); await record(page, pre + "jobs-list", { full: true })
    await page.goto(B + `/jobs?host=${A}`); await page.waitForTimeout(800); await record(page, pre + "jobs-history-done", { full: true })
    await page.goto(B + `/jobs?job=${jobOf(Bh).id}`); await page.waitForTimeout(800); await record(page, pre + "jobs-failed-callback", { full: true })
    await page.goto(B + `/jobs?job=${jobOf(D).id}`); await page.waitForTimeout(1500); await record(page, pre + "jobs-live-log", { full: true })
    await page.goto(B + `/jobs?status=failed`); await page.waitForTimeout(800); await record(page, pre + "jobs-filter-failed", { full: true })
    await page.goto(B + `/jobs?status=configuring`); await page.waitForTimeout(800); await record(page, pre + "jobs-filter-empty")
    await page.goto(B + "/hosts"); await page.waitForTimeout(800); await record(page, pre + "hosts-failed", { full: true })
    await page.goto(B + "/os-images"); await page.waitForTimeout(800); await record(page, pre + "os-images", { full: true })
    await page.goto(B + "/ssh-keys"); await page.waitForTimeout(800); await record(page, pre + "ssh-keys", { full: true })
    await page.goto(B + "/settings"); await page.waitForTimeout(800); await record(page, pre + "settings", { full: true })
    await page.goto("http://localhost:3261/settings"); await page.waitForTimeout(800); await record(page, pre + "settings-insecure", { full: true })
  }
  // dialogs / interaktif desktop
  const page = await newPage()
  await page.goto(B + "/os-images"); await page.waitForTimeout(600)
  await page.getByRole("button", { name: "Daftarkan image" }).first().click(); await page.getByRole("dialog").waitFor(); await record(page, "os-register-dialog", { keepMouse: false })
  // submit kosong → error
  const dlg = page.getByRole("dialog"); await dlg.getByRole("button", { name: /Daftarkan/ }).last().click(); await page.waitForTimeout(800); await record(page, "os-register-errors")
  await page.keyboard.press("Escape"); await page.waitForTimeout(400)
  await page.locator("tr", { hasText: "ubuntu-24.04" }).getByRole("button").last().click(); await page.waitForTimeout(500); await record(page, "os-delete-confirm")
  await page.getByRole("alertdialog").getByRole("button").last().click(); await page.waitForTimeout(800); await record(page, "os-delete-409")
  await page.keyboard.press("Escape")
  await page.goto(B + "/ssh-keys"); await page.waitForTimeout(600)
  await page.getByRole("button", { name: /Tambah key/i }).first().click(); await page.getByRole("dialog").waitFor(); await record(page, "ssh-add-dialog")
  await page.getByRole("dialog").locator("textarea").fill("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl preview@host"); await page.waitForTimeout(600); await record(page, "ssh-add-preview")
  await page.keyboard.press("Escape"); await page.waitForTimeout(400)
  await page.locator("tr", { hasText: "bastion-ecdsa" }).getByRole("button").last().click(); await page.waitForTimeout(500); await record(page, "ssh-delete-confirm")
  await page.keyboard.press("Escape"); await page.waitForTimeout(400)
  // hosts sheet failed
  await page.goto(B + "/hosts"); await page.waitForTimeout(800)
  let s = await openSheet(page, "52:54:00:99:00:62"); await record(page, "sheet-failed-host")
  await page.keyboard.press("Escape"); await page.waitForTimeout(400)
  s = await openSheet(page, "52:54:00:99:00:64"); await record(page, "sheet-mac-title")
  await s.getByRole("button", { name: /^(Simpan & Install|Install)$/ }).click(); await page.getByRole("alertdialog").waitFor(); await record(page, "install-confirm")
  await page.getByRole("alertdialog").getByRole("button", { name: "Hapus disk & install" }).click(); await page.waitForTimeout(1500); await record(page, "install-rejected-single")
  await page.keyboard.press("Escape"); await page.waitForTimeout(400)
  await rowByMac(page, "52:54:00:99:00:61").getByRole("button", { name: /^Aksi untuk/ }).click(); await page.waitForTimeout(500); await record(page, "row-menu-reboot", { keepMouse: true })
  await page.keyboard.press("Escape"); await page.waitForTimeout(300)
  // bulk partial: A (ok), D (active job → gagal), C (failed? ok) 
  for (const n of ["web-node-061", "52:54:00:99:00:64"]) {
    const r = rowByMac(page, n.includes(":") ? n : "52:54:00:99:00:61"); await r.getByRole("checkbox").click()
  }
  await page.getByRole("toolbar", { name: "Aksi untuk host terpilih" }).getByRole("button", { name: "Install OS" }).click()
  s = page.getByRole("dialog", { name: /Konfigurasi 2 host/ }); await s.waitFor(); await record(page, "bulk-sheet-os")
  await s.locator('[id="os-ubuntu-24.04"]').click()
  await s.getByRole("button", { name: "Simpan & Install" }).click(); await page.getByRole("alertdialog").getByRole("button", { name: "Hapus disk & install" }).click(); await page.waitForTimeout(1500); await record(page, "bulk-partial")
  const m = await newPage(375, 812)
  await m.goto(B + "/hosts"); await m.waitForTimeout(800)
  await openSheet(m, "52:54:00:99:00:62"); await record(m, "mobile-sheet-failed-host")
  await m.keyboard.press("Escape")
  await m.goto(B + "/os-images"); await m.waitForTimeout(600); await m.getByRole("button", { name: "Daftarkan image" }).first().click(); await m.getByRole("dialog").waitFor(); await record(m, "mobile-os-register-dialog")
  await m.goto(B + "/ssh-keys"); await m.waitForTimeout(600); await m.getByRole("button", { name: /Tambah key/i }).first().click(); await m.getByRole("dialog").waitFor(); await record(m, "mobile-ssh-add-dialog")
} catch (e) { console.error("ERR", e.message.slice(0, 600)) }
writeFileSync(path.join(OUT, "audit-results.json"), JSON.stringify(results, null, 1))
await browser.close()
