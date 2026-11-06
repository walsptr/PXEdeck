// M7-T7 (test-engineer): integration route handler /boot/** dengan topologi VLAN (DB :memory:,
// lease dnsmasq fixture, PXE_INSECURE_NO_LEASE_CHECK=0). Nilai env = blok jaringan
// infra/server/dashboard-vlan.env (VLAN 10 PXE native, VLAN 20 management terdaftar).
//   AC-7.5  regresi binding IP (F6) host ber-VLAN: status/log dari IP statis VLAN 20 → 200,
//           `done` menyetel current_ip = IP VLAN; IP lain (10.99.20.99, 10.99.0.1) dan MAC salah
//           → 404 seragam tanpa efek; GET user-data dari IP statis VLAN (bukan lease/current_ip)
//           → 404, dari IP lease → 200.
//   AC-7.6  (bagian integration) install Debian diizinkan dengan PXE_SERVER_IP VLAN (media lokal);
//           varian PXE_MEDIA_URL=http://10.99.0.2/media → 422 debianExternalMediaError.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { utimesSync, writeFileSync } from "node:fs"
import path from "node:path"

import { applyConfig } from "@/lib/server/config-service"
import { getHost } from "@/lib/server/db/repos/hosts"
import { eventsAfter } from "@/lib/server/db/repos/job-events"
import { getActiveJob, listJobsForHost } from "@/lib/server/db/repos/jobs"
import { debianExternalMediaError } from "@/lib/server/installers/context"
import { clearLeaseCache } from "@/lib/server/leases"
import { getSettings } from "@/lib/server/settings"
import { dbSnapshot, makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD, SSH_ED25519 } from "@/test/fixtures"
import { jsonReq } from "@/test/route"

import { POST as installPOST } from "../api/hosts/[id]/install/route"
import { GET as bootGET } from "./[name]/route"
import { GET as fileGET } from "./[name]/[token]/[file]/route"
import { POST as logPOST } from "./[name]/[token]/log/route"
import { POST as statusPOST } from "./[name]/[token]/status/route"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

const MEDIA = makeMediaRoot(tmpDir("m7te-media"))
const LEASE_DIR = tmpDir("m7te-leases")
const LEASE_FILE = path.join(LEASE_DIR, "dnsmasq.leases")
writeFileSync(LEASE_FILE, "")
const ENV = {
  PXE_MGMT_CIDR: "10.99.10.0/24",
  PXE_MGMT_GATEWAY: "10.99.10.1",
  PXE_MGMT_DNS: "10.99.10.2",
  PXE_SERVER_IP: "10.99.10.2",
  PXE_DHCP_RANGE: "10.99.10.100-10.99.10.200",
  PXE_VLAN_NETWORKS: "20:10.99.20.0/24:10.99.20.1",
  PXE_BASE_URL: "http://10.99.10.2",
  PXE_MEDIA_URL: "http://10.99.10.2/media",
  PXE_MEDIA_ROOT: MEDIA,
  PXE_TRUST_PROXY: "1",
  PXE_INSECURE_NO_LEASE_CHECK: "0",
  PXE_DNSMASQ_LEASES: LEASE_FILE,
}
withDb("empty", ENV)

const MAC = "52:54:00:99:00:31"
const ID = "525400990031"
const MAC2 = "52:54:00:99:00:32"
const ID2 = "525400990032"
const LEASE_IP = "10.99.10.150"
const LEASE_IP2 = "10.99.10.151"
const VLAN_IP = "10.99.20.41"
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//
const NOT_FOUND = "not found\n"

beforeEach(() => {
  writeLeases([`${exp()} ${MAC} ${LEASE_IP} * *`, `${exp()} ${MAC2} ${LEASE_IP2} * *`])
})
afterEach(() => {
  clearLeaseCache()
})

const p = <T extends object>(v: T) => ({ params: Promise.resolve(v) }) as never
function req(url: string, ip: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (ip) headers.set("x-real-ip", ip)
  return new Request(`http://10.99.10.2${url}`, { ...init, headers })
}
const exp = () => Math.floor(Date.now() / 1000) + 3600
function writeLeases(lines: string[]) {
  const f = LEASE_FILE
  writeFileSync(f, lines.join("\n") + "\n")
  const t = Date.now() / 1000 + Math.random() * 1000
  utimesSync(f, t, t)
  clearLeaseCache()
}

async function boot(mac: string, ip: string) {
  const res = await bootGET(req(`/boot/${mac}.ipxe?platform=efi`, ip), p({ name: `${mac}.ipxe` }))
  return { res, body: await res.text() }
}
async function file(token: string, name: string, ip: string, mac = MAC) {
  const res = await fileGET(req(`/boot/${mac}/${token}/${name}`, ip), p({ name: mac, token, file: name }))
  return { status: res.status, body: await res.text() }
}
async function status(token: string, stage: string, ip: string, mac = MAC) {
  const res = await statusPOST(
    req(`/boot/${mac}/${token}/status`, ip, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `stage=${stage}`,
    }),
    p({ name: mac, token }),
  )
  return { status: res.status, body: await res.text() }
}
async function log(token: string, text: string, ip: string, mac = MAC) {
  const res = await logPOST(
    req(`/boot/${mac}/${token}/log`, ip, { method: "POST", headers: { "content-type": "text/plain" }, body: text }),
    p({ name: mac, token }),
  )
  return { status: res.status, body: await res.text() }
}

/** Host ditemukan lewat boot PXE (lease VLAN 10) lalu dikonfigurasi statis VLAN 20. */
async function readyVlanHost(osImageId: string, mac = MAC, id = ID, leaseIp = LEASE_IP, ip = VLAN_IP) {
  await boot(mac, leaseIp)
  const r = await applyConfig([id], {
    os: { osImageId, disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
    network: { mode: "static", prefix: 24, gateway: "10.99.20.1", dns: ["10.99.10.2"], vlan: 20, iface: { by: "mac" }, assignments: { [id]: ip } },
    hostname: { assignments: { [id]: `m7-node${id.slice(-2)}` } },
    ssh: { keyIds: [], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
}
const install = (id = ID) => installPOST(jsonReq(`/api/hosts/${id}/install`, "POST"), p({ id }))

async function installAndBoot(osImageId = "ubuntu-24.04", mac = MAC, id = ID, leaseIp = LEASE_IP, ip = VLAN_IP) {
  await readyVlanHost(osImageId, mac, id, leaseIp, ip)
  expect((await install(id)).status).toBe(200)
  const { body } = await boot(mac, leaseIp)
  const m = TOKEN_RE.exec(body)
  expect(m, body).not.toBeNull()
  return m![1]
}

// ---------------------------------------------------------------------------
describe("AC-7.5 regresi binding IP (F6) dengan host ber-VLAN 20", () => {
  it("konfigurasi tersimpan: vlan 20, mgmt_ip 10.99.20.41; current_ip awal = lease VLAN 10", async () => {
    await readyVlanHost("ubuntu-24.04")
    const h = getHost(ID)!
    expect(h.mgmtIp).toBe(VLAN_IP)
    expect(h.currentIp).toBe(LEASE_IP)
  })

  it("GET user-data dari IP statis VLAN (bukan lease/current_ip) → 404 seragam; dari IP lease → 200", async () => {
    const token = await installAndBoot()
    const before = dbSnapshot()
    const bad = await file(token, "user-data", VLAN_IP)
    expect(bad).toEqual({ status: 404, body: NOT_FOUND })
    expect(dbSnapshot()).toBe(before)
    const ok = await file(token, "user-data", LEASE_IP)
    expect(ok.status).toBe(200)
    expect(ok.body).toContain("mgmt.20")
    expect(ok.body).toContain(`${VLAN_IP}/24`)
    expect(ok.body).not.toContain(token)
  })

  it("status configuring/done + log dari 10.99.20.41 → 200; done menyetel current_ip = 10.99.20.41", async () => {
    const token = await installAndBoot()
    expect((await file(token, "user-data", LEASE_IP)).status).toBe(200)
    // Installer masih di VLAN 10 saat installing (lease).
    expect((await status(token, "installing", LEASE_IP)).status).toBe(200)
    // Setelah pindah ke VLAN 20 (O5): configuring, log, done dari IP statis VLAN.
    expect((await status(token, "configuring", VLAN_IP)).status).toBe(200)
    expect(getHost(ID)!.status).toBe("configuring")
    const lg = await log(token, "firstboot: vlan mgmt.20 up\n", VLAN_IP)
    expect(lg.status).toBe(200)
    const j = listJobsForHost(ID)[0]
    expect(eventsAfter(j.id, 0, 1000).some((e) => e.kind === "installer" && e.message.includes("vlan mgmt.20 up"))).toBe(true)
    expect((await status(token, "done", VLAN_IP)).status).toBe(200)
    const h = getHost(ID)!
    expect(h.status).toBe("done")
    expect(h.currentIp).toBe(VLAN_IP)
    expect(listJobsForHost(ID)[0]).toMatchObject({ status: "done" })
    const done = eventsAfter(j.id, 0, 1000).filter((e) => e.kind === "stage" && e.source === "callback")
    expect(done.at(-1)!.message).toContain(`callback dari IP ${VLAN_IP}`)
  })

  it.each([
    ["IP lain di VLAN 20", "10.99.20.99"],
    ["host admin segmen pxe-test", "10.99.0.1"],
    ["gateway VLAN 20", "10.99.20.1"],
  ])("status/log dari %s (%s) → 404 seragam, tanpa efek", async (_n, ip) => {
    const token = await installAndBoot()
    expect((await file(token, "user-data", LEASE_IP)).status).toBe(200)
    expect((await status(token, "installing", LEASE_IP)).status).toBe(200)
    const before = dbSnapshot()
    const jobId = listJobsForHost(ID)[0].id
    const evBefore = eventsAfter(jobId, 0, 1000).length
    for (const stage of ["configuring", "done"]) expect(await status(token, stage, ip)).toEqual({ status: 404, body: NOT_FOUND })
    expect(await log(token, "spoof\n", ip)).toEqual({ status: 404, body: NOT_FOUND })
    expect(await file(token, "user-data", ip)).toEqual({ status: 404, body: NOT_FOUND })
    expect(dbSnapshot()).toBe(before)
    expect(eventsAfter(jobId, 0, 1000)).toHaveLength(evBefore)
    expect(getHost(ID)).toMatchObject({ status: "installing", currentIp: LEASE_IP })
  })

  it("MAC salah (token host lain) dari IP VLAN pemilik → 404 seragam; IP VLAN host lain tidak berlaku silang", async () => {
    const t1 = await installAndBoot()
    const t2 = await installAndBoot("ubuntu-24.04", MAC2, ID2, LEASE_IP2, "10.99.20.42")
    expect((await status(t1, "installing", LEASE_IP)).status).toBe(200)
    expect((await status(t2, "installing", LEASE_IP2, MAC2)).status).toBe(200)
    const before = dbSnapshot()
    // Token node31 dengan MAC node32 (dan sebaliknya) → mac-mismatch.
    expect(await status(t1, "done", VLAN_IP, MAC2)).toEqual({ status: 404, body: NOT_FOUND })
    expect(await log(t1, "x\n", VLAN_IP, MAC2)).toEqual({ status: 404, body: NOT_FOUND })
    // Token & MAC node31 benar, tetapi dari IP VLAN milik node32 → ditolak.
    expect(await status(t1, "done", "10.99.20.42")).toEqual({ status: 404, body: NOT_FOUND })
    expect(await status(t2, "done", VLAN_IP, MAC2)).toEqual({ status: 404, body: NOT_FOUND })
    expect(dbSnapshot()).toBe(before)
    // Kontrol positif: masing-masing dari IP VLAN-nya sendiri.
    expect((await status(t1, "done", VLAN_IP)).status).toBe(200)
    expect((await status(t2, "done", "10.99.20.42", MAC2)).status).toBe(200)
    expect([getHost(ID)!.currentIp, getHost(ID2)!.currentIp]).toEqual([VLAN_IP, "10.99.20.42"])
  })

  it("setelah done: token dicabut → callback ulang dari IP VLAN 404", async () => {
    const token = await installAndBoot()
    expect((await status(token, "done", VLAN_IP)).status).toBe(200)
    expect(await status(token, "done", VLAN_IP)).toEqual({ status: 404, body: NOT_FOUND })
    expect(await log(token, "late\n", VLAN_IP)).toEqual({ status: 404, body: NOT_FOUND })
  })
})

// ---------------------------------------------------------------------------
describe("AC-7.6 (integration) DEC-021/022 dengan PXE_SERVER_IP di VLAN PXE", () => {
  it("media lokal http://10.99.10.2/media → install Debian ber-VLAN 20 mulai (200); preseed dilayani ke IP lease", async () => {
    expect(getSettings().mediaUrl).toBe("http://10.99.10.2/media")
    expect(getSettings().network.pxeServer).toBe("10.99.10.2")
    const token = await installAndBoot("debian-12")
    expect(getActiveJob(ID)).toMatchObject({ osImageId: "debian-12" })
    const pre = await file(token, "preseed.cfg", LEASE_IP)
    expect(pre.status).toBe(200)
    expect(pre.body).toContain("http://10.99.10.2/media")
    expect(pre.body).not.toContain(token)
  })

  it("varian PXE_MEDIA_URL=http://10.99.0.2/media (PXE_SERVER_IP=10.99.10.2) → 422 debianExternalMediaError, tanpa job", async () => {
    await readyVlanHost("debian-12")
    process.env.PXE_MEDIA_URL = "http://10.99.0.2/media"
    const before = dbSnapshot()
    const res = await install()
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.started).toEqual([])
    expect(body.failed).toHaveLength(1)
    expect(body.failed[0].message).toBe(`m7-node31: ${debianExternalMediaError("http://10.99.0.2/media", "10.99.10.2")}`)
    expect(getActiveJob(ID)).toBeNull()
    expect(dbSnapshot()).toBe(before)
  })
})
