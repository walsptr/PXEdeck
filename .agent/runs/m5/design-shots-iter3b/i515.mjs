// I-5-15: jarak vertikal kotak tombol Hapus ke baris nama (mode kartu) + perataan dengan baris ID.
import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const b = await chromium.launch()
for (const w of [375, 414, 768, 1024, 1279]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage()
  await p.goto("http://localhost:3260/os-images"); await p.waitForSelector("[data-testid=os-image-row]"); await p.waitForTimeout(500)
  const r = await p.evaluate(() => [...document.querySelectorAll("[data-testid=os-image-row]")].map((tr) => {
    const btn = tr.querySelector("button").getBoundingClientRect()
    const nameCell = tr.querySelector("[data-testid=img-name]").closest("td").getBoundingClientRect()
    const idSpan = tr.querySelector("[data-testid=img-id] span"); const rg = document.createRange(); rg.selectNodeContents(idSpan); const first = rg.getClientRects()[0]
    const rr = tr.getBoundingClientRect()
    return { id: tr.dataset.imageId.slice(0, 20), gap: +(nameCell.top - btn.bottom).toFixed(1), btnTopInRow: +(btn.top - rr.top).toFixed(1), btnCenterVsId: +((btn.top + btn.height / 2) - (first.top + first.height / 2)).toFixed(1), btnH: btn.height, btnW: btn.width }
  }))
  const gaps = r.map((x) => x.gap)
  console.log(`@${w} gap min ${Math.min(...gaps)} max ${Math.max(...gaps)} | btnCenter-idCenter ${[...new Set(r.map((x) => x.btnCenterVsId))].join(",")} | btnTopInRow ${[...new Set(r.map((x) => x.btnTopInRow))].join(",")} | btn ${r[0].btnW}x${r[0].btnH}`)
  await p.close()
}
await b.close()
