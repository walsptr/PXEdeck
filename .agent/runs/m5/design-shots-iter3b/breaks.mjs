// Probe keterbacaan wrap-anywhere (read-only): untuk setiap ID/nama/path/alasan, rekonstruksi baris
// per karakter (Range.getClientRects) dan klasifikasikan titik pecah: "natural" bila char sebelum
// pecah ∈ [-/._ space] atau batas segmen inline-block; "mid" bila di tengah kata.
// Mode "before": injeksi CSS overflow-wrap:break-word (kelas lama) di browser untuk pembanding.
import { writeFileSync } from "node:fs"
import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const OUT = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m5/design-shots-iter3b"
const probe = () => {
  const lines = (el) => {
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const chars = []
    let n; while ((n = tw.nextNode())) for (let i = 0; i < n.length; i++) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); const rc = r.getClientRects()[0]; if (rc) chars.push({ c: n.data[i], top: Math.round(rc.top) }) }
    const out = []; let cur = null
    for (const ch of chars) { if (!cur || Math.abs(ch.top - cur.top) > 3) { cur = { top: ch.top, s: "" }; out.push(cur) } cur.s += ch.c }
    return out.map((l) => l.s)
  }
  const classify = (ls) => ls.slice(0, -1).map((l, i) => { const a = l.slice(-1), b = ls[i + 1][0]; return /[-/._ ]/.test(a) || b === " " || /[-/.]/.test(b) ? "nat" : "MID" })
  const res = []
  for (const tr of document.querySelectorAll("[data-testid=os-image-row]")) {
    const id = tr.dataset.imageId
    const els = [["id", tr.querySelector("[data-testid=img-id] span")], ["name", tr.querySelector("[data-testid=img-name]")],
      ...[...tr.querySelectorAll("[data-testid=img-source] span.type-data")].map((e, i) => ["path" + i, e]),
      ["reason", tr.querySelector("[data-available=false] span.min-w-0")]]
    for (const [k, el] of els) { if (!el || !el.getBoundingClientRect().width) continue; const ls = lines(el); const cl = classify(ls); res.push({ id, k, lines: ls, mid: cl.filter((x) => x === "MID").length }) }
  }
  return res
}
const TAG = process.argv[2] ?? "stress"; const b = await chromium.launch(); const all = {}
for (const mode of ["after", "before"]) for (const w of [375, 414, 768, 1024, 1279, 1280, 1440]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage()
  await p.goto("http://localhost:3260/os-images"); await p.waitForSelector("[data-testid=os-image-row]"); await p.waitForTimeout(500)
  if (mode === "before") await p.addStyleTag({ content: ".wrap-anywhere{overflow-wrap:break-word!important}" })
  await p.waitForTimeout(100)
  const r = await p.evaluate(probe); all[`${mode}@${w}`] = r
  const mids = r.filter((x) => x.mid)
  console.log(`${mode}@${w}: elems ${r.length}, mid-word breaks ${mids.reduce((s, x) => s + x.mid, 0)}; ubuntu-24.04 id lines ${r.find((x) => x.id === "ubuntu-24.04" && x.k === "id").lines.length}`)
  for (const m of mids) console.log("   ", m.id.slice(0, 24).padEnd(24), m.k.padEnd(6), JSON.stringify(m.lines))
  if (mode === "after" && (w === 1280 || w === 375)) await p.locator("[data-slot=table-container]").screenshot({ path: `${OUT}/table-${TAG}-${w}.png` })
  await p.close()
}
writeFileSync(`${OUT}/breaks-${TAG}.json`, JSON.stringify(all, null, 1))
await b.close()
