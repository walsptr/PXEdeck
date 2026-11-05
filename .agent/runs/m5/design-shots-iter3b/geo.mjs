// Probe geometri OS Images iter3 (read-only) — 375/414/768/1024/1280/1440 + cek design system.
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const OUT = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m5/design-shots-iter3b"
const src = readFileSync("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m4/design/audit.mjs", "utf8")
const measureSrc = src.slice(src.indexOf("function measure() {"), src.indexOf("\nconst results"))
const geo = () => {
  const rows = [...document.querySelectorAll("[data-testid=os-image-row]")]
  const cont = document.querySelector("[data-slot=table-container]"); const cr = cont.getBoundingClientRect()
  const box = (el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return b }
  const out = rows.map((tr) => {
    const rr = tr.getBoundingClientRect()
    const tds = [...tr.children].filter((td) => getComputedStyle(td).display !== "none")
    const boxes = tds.map((td, i) => { const b = box(td); return { i, t: (td.innerText.trim().split("\n")[0] || "(aksi)").slice(0, 28), l: b.left, r: b.right, top: b.top, b: b.bottom } })
    const ov = []
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j]; const x = Math.min(a.r, c.r) - Math.max(a.l, c.l), y = Math.min(a.b, c.b) - Math.max(a.top, c.top)
      if (x > 0.5 && y > 0.5) ov.push(`${a.t} <> ${c.t} (${x.toFixed(1)}x${y.toFixed(1)})`)
    }
    const spill = []
    for (const el of tr.querySelectorAll("*")) {
      const b = el.getBoundingClientRect(); if (!b.width) continue
      if (b.right > rr.right + 0.5 || b.left < rr.left - 0.5) spill.push(`${el.tagName}.${String(el.className.baseVal ?? el.className).slice(0, 30)} ${Math.round(b.left)}-${Math.round(b.right)} vs ${Math.round(rr.left)}-${Math.round(rr.right)}`)
      if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") spill.push(`clip ${el.tagName} ${el.textContent.slice(0, 30)} sw${el.scrollWidth}>cw${el.clientWidth}`)
    }
    const idTd = tr.querySelector("[data-testid=img-id]"), idSpan = idTd.querySelector("span")
    const idLines = new Set([...box(idSpan).height ? [...(() => { const r = document.createRange(); r.selectNodeContents(idSpan); return r.getClientRects() })()].map((x) => Math.round(x.top)) : []]).size
    const plat = tr.querySelector("[data-testid=img-platform]")
    const used = tr.querySelector("[data-testid=img-used-by]"); const del = tr.querySelector("button")
    const ub = box(used), db = del.getBoundingClientRect()
    const name = tr.querySelector("[data-testid=img-name]")
    return {
      id: tr.dataset.imageId, display: getComputedStyle(tr).display, h: Math.round(rr.height), w: Math.round(rr.width),
      overlaps: ov, spill: spill.slice(0, 6),
      idText: idSpan.textContent === tr.dataset.imageId, idLines, idMono: getComputedStyle(idSpan).fontFamily.startsWith('"JetBrains Mono'), idW: Math.round(idSpan.getBoundingClientRect().width), idTdW: Math.round(idTd.getBoundingClientRect().width),
      idClip: idSpan.scrollWidth > idSpan.clientWidth + 1, idEllipsis: getComputedStyle(idSpan).textOverflow,
      nameLines: name ? Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)) : null,
      platform: plat ? { text: plat.innerText.replace(/\n/g, " | "), h: Math.round(plat.getBoundingClientRect().height), parts: [...plat.querySelectorAll("div > span")].map((s) => ({ t: s.textContent, ff: getComputedStyle(s).fontFamily.slice(0, 16), fs: getComputedStyle(s).fontSize, color: getComputedStyle(s).color })) } : null,
      usedRight: Math.round(ub.right), delRight: Math.round(db.right), delVisibleInCont: db.right <= cr.right + 0.5 && db.width > 0,
      usedText: used.innerText.trim(),
    }
  })
  const ths = [...cont.querySelectorAll("th")].filter((t) => getComputedStyle(t).display !== "none").map((t) => { const b = t.getBoundingClientRect(); return `${t.innerText.trim() || "(aksi)"}@${Math.round(b.left)}-${Math.round(b.right)}${b.right > cr.right + 1 ? "!HIDDEN" : ""}` })
  return { docSW: document.documentElement.scrollWidth, docSH: document.documentElement.scrollHeight, contSW: cont.scrollWidth, contCW: cont.clientWidth, ths, rows: out }
}
const b = await chromium.launch()
const results = []
for (const [w, h] of [[375, 812], [414, 896], [768, 1024], [1024, 768], [1279, 800], [1280, 800], [1440, 900]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" }); const p = await ctx.newPage()
  await p.goto("http://localhost:3260/os-images"); await p.waitForSelector("[data-testid=os-image-row]"); await p.waitForTimeout(800)
  const g = await p.evaluate(geo)
  const ds = await p.evaluate(`(() => { ${measureSrc}\n const m = measure(); const h1 = document.querySelector("h1"); const hs = getComputedStyle(h1); return { bodyBg: getComputedStyle(document.body).backgroundColor, h1: { fs: hs.fontSize, fw: hs.fontWeight, ls: hs.letterSpacing, lh: hs.lineHeight }, drop: m.shadows.filter(s => s.kind === "drop"), rings: m.shadows.length, orangeNonCta: m.orange.filter(o => !o.cta && !o.focus), orange: m.orange.map(o => o.text + "|" + o.props), pastelOutsidePill: m.pastel.filter(x => !x.inPill), techNonMono: (m.tech||[]).filter(t => !t.mono).map(t=>t.text) } })()`)
  // cek mono semua sel data teknis OS Images: id, arch, path
  const mono = await p.evaluate(() => [...document.querySelectorAll("[data-testid=img-id] span, [data-testid=img-platform] span.type-data, [data-testid=img-source] span.type-data")].filter(e => !getComputedStyle(e).fontFamily.startsWith('"JetBrains Mono')).map(e => e.textContent))
  const radius = await p.evaluate(() => { const c = document.querySelector("[data-slot=table-container]").parentElement; return getComputedStyle(c).borderTopLeftRadius })
  // aksi: scroll ke baris panjang, cek Hapus di viewport
  const vis = await p.evaluate(() => { const tr = document.querySelector('[data-image-id="ubuntu-24.04-custom-hwe-lab-rack07-node-image-02"]'); tr.scrollIntoView({ block: "center" }); const d = tr.querySelector("button").getBoundingClientRect(); return { scrollX: scrollX, delInViewport: d.left >= 0 && d.right <= innerWidth } })
  await p.evaluate(() => scrollTo(0, 0))
  await p.screenshot({ path: `${OUT}/os-images-${w}.png`, fullPage: true })
  results.push({ w, ...g, ds, monoFail: mono, radius, vis })
  const sum = g.rows.map(r => `${r.id.slice(0, 22)} ${r.display} h${r.h} ov${r.overlaps.length} sp${r.spill.length} idL${r.idLines} idOK${r.idText && !r.idClip && r.idMono}`).join("\n   ")
  console.log(`@${w} docSW ${g.docSW} cont ${g.contSW}/${g.contCW} docSH ${g.docSH} ths ${g.ths.join(" ")}\n   ${sum}\n   bg ${ds.bodyBg} h1 ${JSON.stringify(ds.h1)} drop ${ds.drop.length} orangeNonCta ${ds.orangeNonCta.length} orange ${JSON.stringify(ds.orange)} pastelOut ${ds.pastelOutsidePill.length} techNonMono ${JSON.stringify(ds.techNonMono)} monoFail ${JSON.stringify(mono)} radius ${radius} vis ${JSON.stringify(vis)}`)
  await ctx.close()
}
writeFileSync(`${OUT}/geo-results.json`, JSON.stringify(results, null, 1))
await b.close()
