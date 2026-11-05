import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const b = await chromium.launch()
for (const w of [375, 414, 767]) {
const p = await (await b.newContext({ viewport: { width: w, height: 812 }, reducedMotion: "reduce" })).newPage()
await p.goto("http://localhost:3260/os-images"); await p.waitForTimeout(1200)
const r = await p.evaluate(() => [...document.querySelectorAll("tbody tr")].map(tr => {
  const tds = [...tr.children].filter(td => getComputedStyle(td).display !== "none")
  const boxes = tds.map(td => { const range = document.createRange(); range.selectNodeContents(td); const rr = range.getBoundingClientRect(); return { t: td.innerText.trim().split("\n")[0].slice(0,30), l: Math.round(rr.left), r: Math.round(rr.right), top: Math.round(rr.top), b: Math.round(rr.bottom), tdL: Math.round(td.getBoundingClientRect().left), tdR: Math.round(td.getBoundingClientRect().right), ws: getComputedStyle(td).whiteSpace, order: getComputedStyle(td).order, cls: td.className.slice(0,140) } })
  const ov = []
  for (let i = 0; i < boxes.length; i++) for (let j = i+1; j < boxes.length; j++) { const a = boxes[i], c = boxes[j]; if (a.l < c.r - 1 && c.l < a.r - 1 && a.top < c.b - 1 && c.top < a.b - 1) ov.push(`${a.t} <> ${c.t} (${Math.min(a.r,c.r)-Math.max(a.l,c.l)}px)`) }
  return { id: boxes[0]?.t, ov, first: boxes.slice(0,3) }
}))
console.log(w); for (const x of r) console.log(" ", x.id, JSON.stringify(x.ov)); if (w===375) console.log(JSON.stringify(r.find(x=>x.id.startsWith("ubuntu-24.04-c")).first,null,0))
}
await b.close()
