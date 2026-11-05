import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const B = "http://localhost:3260"
const j = (await (await fetch(B + "/api/jobs")).json()).jobs.find((x) => x.status === "failed")
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto(`${B}/jobs?host=${j.hostId}&job=${j.id}`); await p.waitForTimeout(1500)
console.log(await p.evaluate(() => [...document.querySelectorAll("pre, [data-testid*=log] *")].filter(e => e.children.length === 0 && e.textContent.trim() && !getComputedStyle(e).fontFamily.startsWith('"JetBrains Mono')).map(e => `${e.tagName} ${e.closest("[data-testid]")?.dataset.testid} "${e.textContent.trim().slice(0, 60)}"`)))
await b.close()
