// Cek regresi design system sekilas: halaman lain @1440 dan @375 (read-only).
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const OUT = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m5/design-shots-iter3"
const B = "http://localhost:3260"
const src = readFileSync("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m4/design/audit.mjs", "utf8")
const measureSrc = src.slice(src.indexOf("function measure() {"), src.indexOf("\nconst results"))
const jobs = (await (await fetch(B + "/api/jobs")).json()).jobs
const pick = (s) => jobs.find((j) => j.status === s)
const pages = [["hosts", "/hosts"], ["ssh-keys", "/ssh-keys"], ["settings", "/settings"], ["jobs-list", "/jobs"],
  ["jobs-live-log", `/jobs?host=${pick("installing").hostId}&job=${pick("installing").id}`],
  ["jobs-failed", `/jobs?host=${pick("failed").hostId}&job=${pick("failed").id}`],
  ["jobs-done", `/jobs?host=${pick("done").hostId}&job=${pick("done").id}`]]
const b = await chromium.launch(); const res = []
for (const [w, h] of [[1440, 900], [375, 812]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" }); const p = await ctx.newPage()
  for (const [name, url] of pages) {
    await p.goto(B + url); await p.waitForTimeout(1500)
    const r = await p.evaluate(`(() => { ${measureSrc}\n const m = measure(); const h1 = document.querySelector("h1"); const hs = h1 && getComputedStyle(h1);
      const logs = [...document.querySelectorAll("pre, [data-testid*=log] *")].filter(e => e.children.length === 0 && e.textContent.trim()).map(e => getComputedStyle(e).fontFamily.startsWith('"JetBrains Mono'))
      return { bodyBg: getComputedStyle(document.body).backgroundColor, sw: document.documentElement.scrollWidth, h1: hs && [hs.fontSize, hs.fontWeight, hs.letterSpacing].join("/"), drop: m.shadows.filter(s => s.kind === "drop").map(s => s.text), orangeNonCta: m.orange.filter(o => !o.cta && !o.focus).map(o => o.text + "|" + o.props), pastelOut: m.pastel.filter(x => !x.inPill).map(x => x.text + "|" + x.stage), techNonMono: (m.tech || []).filter(t => !t.mono).map(t => t.text), techN: (m.tech || []).length, logNonMono: logs.filter(x => !x).length, logN: logs.length } })()`)
    await p.screenshot({ path: `${OUT}/${w === 375 ? "mobile-" : ""}${name}.png` })
    res.push({ w, name, ...r }); console.log(w, name, JSON.stringify(r))
  }
  await ctx.close()
}
writeFileSync(`${OUT}/pages-results.json`, JSON.stringify(res, null, 1)); await b.close()
