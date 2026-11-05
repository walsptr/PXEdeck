import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const OUT = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m5/design-shots-iter3b"
const b = await chromium.launch()
for (const [w, ids] of [[375, ["rocky9customlabimagebuildnumber00000000000000001", "ubuntu-24.04-custom-hwe-lab-rack07-node-image-02", "ubuntu-24.04"]], [1280, ["ubuntu-22.04", "rocky9customlabimagebuildnumber00000000000000001", "ubuntu-24.04"]]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage()
  await p.goto("http://localhost:3260/os-images"); await p.waitForSelector("[data-testid=os-image-row]"); await p.waitForTimeout(500)
  for (const id of ids) await p.locator(`[data-image-id="${id}"]`).screenshot({ path: `${OUT}/crop-${w}-${id.slice(0, 14)}.png` })
  await p.close()
}
await b.close()
