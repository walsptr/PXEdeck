import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const b = await chromium.launch()
for (const w of [768, 800, 900]) {
const p = await (await b.newContext({ viewport: { width: w, height: 900 }, reducedMotion: "reduce" })).newPage()
for (const u of ["/hosts","/os-images","/ssh-keys","/jobs","/settings"]) {
await p.goto("http://localhost:3260"+u); await p.waitForTimeout(1000)
const r = await p.evaluate(() => { const W = document.documentElement.clientWidth; const offs = [...document.querySelectorAll("body *")].filter(e => { const r = e.getBoundingClientRect(); return r.right > W + 1 && r.width > 0 && getComputedStyle(e).display!=="none" }).filter(e => !e.parentElement || e.parentElement.getBoundingClientRect().right <= W + 1).slice(0,4).map(e => `${e.tagName}.${String(e.className).slice(0,60)} r=${Math.round(e.getBoundingClientRect().right)}`); return { sw: document.documentElement.scrollWidth, offs } })
console.log(w, u, JSON.stringify(r))
}}
await b.close()
