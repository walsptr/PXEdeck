import { writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
const DASH = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard"
const require = createRequire(path.join(DASH, "package.json"))
const { createJiti } = require("jiti")
const jiti = createJiti(path.join(DASH, "x.ts"), { alias: { "@": path.join(DASH, "src") } })
const { SSH_ED25519, SSH_RSA, DUMMY_PASSWORD } = await jiti.import(path.join(DASH, "src/test/fixtures.ts"))
const B = "http://localhost:3260"
const LEASE = path.join(DASH, ".e2e-data/design-m5/leases/main.leases")
const leases = new Map()
const lease = (mac, ip) => { leases.set(mac, ip); const exp = Math.floor(Date.now() / 1000) + 36000; writeFileSync(LEASE, [...leases].map(([m, i]) => `${exp} ${m} ${i} * 01:${m}`).join("\n") + "\n") }
const id = (m) => m.replaceAll(":", "")
const req = async (method, url, { ip, body, ct } = {}) => {
  const h = {}; if (ip) h["x-real-ip"] = ip; if (ct) h["content-type"] = ct
  const r = await fetch(B + url, { method, headers: h, body })
  const t = await r.text(); if (r.status >= 300) console.log(method, url, r.status, t.slice(0, 200)); return t
}
const ipxe = (mac, ip) => req("GET", `/boot/${mac}.ipxe?platform=efi`, { ip })
async function makeHost(h) {
  lease(h.mac, h.leaseIp); await ipxe(h.mac, h.leaseIp)
  const body = { os: { osImageId: h.os ?? "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
    network: { mode: "static", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2"], vlan: null, iface: { by: "mac" }, assignments: { [id(h.mac)]: h.staticIp } },
    ssh: { keyIds: [], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" } }
  if (h.hostname) body.hostname = { assignments: { [id(h.mac)]: h.hostname } }
  await req("PATCH", `/api/hosts/${id(h.mac)}`, { body: JSON.stringify(body), ct: "application/json" })
}
const install = (h) => req("POST", `/api/hosts/${id(h.mac)}/install`, { ct: "application/json" })
function sim(h) {
  let token = ""
  return {
    async boot() { const s = await ipxe(h.mac, h.leaseIp); token = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//.exec(s)?.[1] ?? ""; if (!token) console.log("no token", s.slice(0, 300)) },
    file: (n) => req("GET", `/boot/${h.mac}/${token}/${n}`, { ip: h.leaseIp }),
    status: (st, ip = h.leaseIp) => req("POST", `/boot/${h.mac}/${token}/status`, { ip, ct: "application/x-www-form-urlencoded", body: `stage=${st}` }),
    log: (t) => req("POST", `/boot/${h.mac}/${token}/log`, { ip: h.leaseIp, ct: "text/plain", body: t }),
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const A = { mac: "52:54:00:99:00:61", leaseIp: "10.99.0.161", staticIp: "10.99.0.61", hostname: "web-node-061" }
const Bh = { mac: "52:54:00:99:00:62", leaseIp: "10.99.0.162", staticIp: "10.99.0.62", hostname: "db-node-062" }
const C = { mac: "52:54:00:99:00:63", leaseIp: "10.99.0.163", staticIp: "10.99.0.63", hostname: "cache-node-063" }
const D = { mac: "52:54:00:99:00:64", leaseIp: "10.99.0.164", staticIp: "10.99.0.64" }
for (const h of [A, Bh, C, D]) await makeHost(h)
// A: done, then reinstall -> done (2 jobs)
for (let k = 0; k < 2; k++) {
  await install(A); const s = sim(A); await s.boot(); await s.file("meta-data"); await s.file("user-data")
  await s.log("subiquity: running curtin install\ncurtin: partitioning /dev/vda (lvm)\ncurtin: installing kernel linux-generic-hwe-24.04 dari repo http://10.99.0.2/media/ubuntu-24.04 dengan argumen yang sangat panjang sekali untuk menguji wrap baris log di viewer")
  await sleep(1500); await s.status("configuring", A.leaseIp); await s.log("cloud-init: modules:final\nERROR cloud-init: contoh baris error panjang 52:54:00:99:00:61"); await sleep(1500); await s.status("done", A.staticIp)
}
// B: failed via callback
await install(Bh); { const s = sim(Bh); await s.boot(); await s.file("user-data"); await s.log("curtin: error: disk /dev/vda not found"); await s.status("failed", Bh.leaseIp) }
// C: booting, no callback -> watchdog timeout after 1 min
await install(C)
// D: installing, keep logs
await install(D); { const s = sim(D); await s.boot(); await s.file("meta-data"); await s.file("user-data"); for (let i = 0; i < 25; i++) await s.log(`subiquity: step ${i} unpacking packages ${"x".repeat(i % 5 * 10)}`) }
console.log("done")
