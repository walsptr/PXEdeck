import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const b = await chromium.launch()
for (const [w,h] of [[1440,900],[1280,800],[1024,768],[768,1024],[375,812]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" })).newPage()
  for (const url of ["/os-images", "/ssh-keys"]) {
    await p.goto("http://localhost:3260" + url); await p.waitForTimeout(1200)
    const r = await p.evaluate(() => {
      const c = document.querySelector("[data-slot=table-container]"); if (!c) return null
      const cr = c.getBoundingClientRect()
      const ths = [...c.querySelectorAll("th")].filter(t => getComputedStyle(t).display !== "none").map(t => { const b = t.getBoundingClientRect(); return `${t.innerText.trim()||"(aksi)"}@${Math.round(b.left)}-${Math.round(b.right)}${b.right > cr.right + 1 ? "!HIDDEN" : ""}` })
      const firstRow = document.querySelector("tbody tr"); const btn = firstRow?.querySelector("button:last-of-type, [aria-label^=Hapus]"); const del = [...(firstRow?.querySelectorAll("button")??[])].map(x => ({ l: x.getAttribute("aria-label") || x.innerText.trim(), right: Math.round(x.getBoundingClientRect().right), vis: x.getBoundingClientRect().right <= cr.right + 1 && x.getBoundingClientRect().width>0 }))
      return { container: [Math.round(cr.left), Math.round(cr.right)], sw: c.scrollWidth, cw: c.clientWidth, ths, del, docSW: document.documentElement.scrollWidth }
    })
    console.log(w, url, JSON.stringify(r))
  }
}
await b.close()
