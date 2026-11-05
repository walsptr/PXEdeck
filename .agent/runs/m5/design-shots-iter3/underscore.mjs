// Varian realistis: nama dengan underscore (tanpa titik pecah), ID & path ber-hyphen. Dibuat lalu dihapus.
import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const B = "http://localhost:3260"
const body = { id: "zz-underscore-name", name: "ubuntu_24_04_custom_hwe_lab_rack07_image", version: "1", arch: "amd64", method: "autoinstall", bootable: true, source: { kernel: "zz-under/casper/vmlinuz", initrd: "zz-under/casper/initrd", repo: "zz-under" } }
for (const id of ["ubuntu-24.04-custom-hwe-lab-rack07-node-image-02", "rocky9customlabimagebuildnumber00000000000000001", "debian-12.7-bookworm-netinst-lab-cluster-b-arm"]) await fetch(B + "/api/os-images/" + id, { method: "DELETE" })
console.log((await fetch(B + "/api/os-images", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status)
const b = await chromium.launch()
for (const w of [375, 1280]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 800 } })).newPage()
  await p.goto(B + "/os-images"); await p.waitForSelector("[data-testid=os-image-row]"); await p.waitForTimeout(500)
  console.log(w, JSON.stringify(await p.evaluate(() => { const c = document.querySelector("[data-slot=table-container]"); const tr = document.querySelector('[data-image-id="zz-underscore-name"]'); const n = tr.querySelector("[data-testid=img-name]").getBoundingClientRect(); const d = tr.querySelector("button").getBoundingClientRect(); const cr = c.getBoundingClientRect(); return { sw: c.scrollWidth, cw: c.clientWidth, nameRight: Math.round(n.right), contRight: Math.round(cr.right), delRight: Math.round(d.right) } })))
  await p.locator('[data-image-id="zz-underscore-name"]').screenshot({ path: `/home/syawal/Project/PXE-BOOT/.agent/wt-m5/.agent/runs/m5/design-shots-iter3/underscore-name-${w}.png` })
}
await b.close()
console.log((await fetch(B + "/api/os-images/zz-underscore-name", { method: "DELETE" })).status)
