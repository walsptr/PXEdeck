// Isolasi DR-5-9 @1280: varian image satu per satu (dibuat lalu dihapus lewat API), ukur lebar tabel.
import { createRequire } from "node:module"
const require = createRequire("/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/package.json")
const { chromium } = require("playwright")
const B = "http://localhost:3260"
const api = (m, u, body) => fetch(B + u, { method: m, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) }).then(async r => [r.status, (await r.text()).slice(0, 120)])
const base = (id, name, seg) => ({ id, name, version: "1", arch: "amd64", method: "autoinstall", bootable: true, source: { kernel: `${seg}/casper/vmlinuz`, initrd: `${seg}/casper/initrd`, repo: seg } })
const V = [
  ["id48-nohyphen", base("zz" + "a".repeat(46), "Nama Biasa", "zzpath")],
  ["name-nospace-64", base("zz-name", "N".repeat(64), "zzpath2")],
  ["seg-nobreak-120", base("zz-seg", "Nama Biasa", "s".repeat(120))],
  ["name-underscore-40", base("zz-underscore-name", "ubuntu_24_04_custom_hwe_lab_rack07_image", "zz-under")],
  ["id48-hyphen", base("zz-ubuntu-24.04-custom-hwe-lab-rack07-node-img01", "Nama Biasa", "zzpath3")],
]
const W = +(process.argv[2] ?? 1280); console.log("@" + W)
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: W, height: 800 } })).newPage()
// hapus sementara image stres utama agar terisolasi; dipulihkan oleh stress.mjs add sesudahnya
const meas = async (label) => { await p.goto(B + "/os-images"); await p.waitForSelector("[data-testid=os-image-row]"); await p.waitForTimeout(500)
  const r = await p.evaluate(() => { const c = document.querySelector("[data-slot=table-container]"); return { sw: c.scrollWidth, cw: c.clientWidth, ths: [...c.querySelectorAll("th")].map(t => `${t.innerText.trim()||"aksi"}:${Math.round(t.getBoundingClientRect().width)}`).join(" ") } })
  console.log(label.padEnd(18), r.sw + "/" + r.cw, r.sw > r.cw ? "OVERFLOW" : "ok", r.ths) }
await meas("bawaan saja")
for (const [label, body] of V) { const a = await api("POST", "/api/os-images", body); if (a[0] !== 201) { console.log(label, a); continue } await meas(label); await api("DELETE", "/api/os-images/" + body.id) }
await b.close()
