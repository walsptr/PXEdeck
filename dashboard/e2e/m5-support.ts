// Helper E2E M5 (M5-T13, test-engineer). Request firmware/installer disimulasikan dengan `request` +
// header `X-Real-IP` (peran nginx di lab KVM) terhadap server `PXE_TRUST_PROXY=1` + lease fixture.
import { writeFileSync } from "node:fs"

import { expect, type APIRequestContext, type Page } from "@playwright/test"

import { DUMMY_PASSWORD, SSH_ED25519 } from "../src/test/fixtures"

export const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//
export const hostId = (mac: string) => mac.replaceAll(":", "")

/** Penulis file lease dnsmasq per server (format asli: expiry mac ip hostname client-id). */
export function leaseWriter(file: string) {
  const leases = new Map<string, string>()
  return (mac: string, ip: string) => {
    leases.set(mac, ip)
    const exp = Math.floor(Date.now() / 1000) + 3600
    writeFileSync(file, [...leases].map(([m, i]) => `${exp} ${m} ${i} * 01:${m}`).join("\n") + "\n")
  }
}

export async function ipxe(request: APIRequestContext, mac: string, ip: string, platform = "efi") {
  const res = await request.get(`/boot/${mac}.ipxe?platform=${platform}`, { headers: { "x-real-ip": ip } })
  expect(res.status()).toBe(200)
  return res.text()
}

export type HostSpec = { mac: string; leaseIp: string; staticIp?: string; hostname?: string; credentials?: boolean; sshKeyIds?: string[]; newKey?: boolean }

/** Host ditemukan (lease + /boot) lalu dikonfigurasi lewat PATCH /api/hosts/:id. */
export async function makeHost(request: APIRequestContext, lease: (mac: string, ip: string) => void, h: HostSpec) {
  lease(h.mac, h.leaseIp)
  await ipxe(request, h.mac, h.leaseIp)
  const id = hostId(h.mac)
  const body: Record<string, unknown> = {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
  }
  if (h.credentials !== false) body.credentials = { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true }
  if (h.staticIp) body.network = { mode: "static", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2"], vlan: null, iface: { by: "mac" }, assignments: { [id]: h.staticIp } }
  if (h.hostname) body.hostname = { assignments: { [id]: h.hostname } }
  if (h.sshKeyIds) body.ssh = { keyIds: h.sshKeyIds, newKeys: [], user: "" }
  else if (h.newKey) body.ssh = { keyIds: [], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" }
  const res = await request.patch(`/api/hosts/${id}`, { headers: { "content-type": "application/json" }, data: body })
  expect(res.status(), await res.text()).toBe(200)
  return id
}

export async function apiInstall(request: APIRequestContext, id: string) {
  const res = await request.post(`/api/hosts/${id}/install`, { headers: { "content-type": "application/json" } })
  expect(res.status(), await res.text()).toBe(200)
}

/** Simulasi installer satu host: token dari /boot, file, callback, log. */
export function installer(request: APIRequestContext, mac: string, leaseIp: string, staticIp?: string) {
  let token = ""
  return {
    async boot() {
      const s = await ipxe(request, mac, leaseIp)
      token = TOKEN_RE.exec(s)?.[1] ?? ""
      expect(token, s).toHaveLength(43)
      return token
    },
    get token() {
      return token
    },
    async file(name: string) {
      const r = await request.get(`/boot/${mac}/${token}/${name}`, { headers: { "x-real-ip": leaseIp } })
      expect(r.status()).toBe(200)
    },
    async status(stage: string, ip = staticIp ?? leaseIp) {
      return (await request.post(`/boot/${mac}/${token}/status`, { headers: { "x-real-ip": ip, "content-type": "application/x-www-form-urlencoded" }, data: `stage=${stage}` })).status()
    },
    async log(text: string, ip = leaseIp) {
      return (await request.post(`/boot/${mac}/${token}/log`, { headers: { "x-real-ip": ip, "content-type": "text/plain" }, data: text })).status()
    },
  }
}

export async function jobsOf(request: APIRequestContext, id: string) {
  const r = await request.get(`/api/jobs?hostId=${id}`)
  expect(r.status()).toBe(200)
  return ((await r.json()) as { jobs: { id: string; status: string; failureReason: string | null; eventCount: number }[] }).jobs
}

export async function markNoReload(page: Page) {
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))
}
export async function expectNoReload(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
}

/** Warna latar terhitung (rgb) + nilai hex. */
export const HEX = {
  booting: "rgb(223, 168, 143)", // #dfa88f
  installing: "rgb(192, 168, 221)", // #c0a8dd
  configuring: "rgb(159, 201, 162)", // #9fc9a2
  done: "rgb(192, 133, 50)", // #c08532
  failed: "rgb(207, 45, 86)", // #cf2d56
  muted: "rgb(128, 125, 114)", // #807d72
  body: "rgb(90, 88, 82)", // #5a5852
} as const

/** Elemen terlihat ber-latar pastel tahap DI LUAR `[data-status]` (audit AC-5.23). */
export async function pastelOutsidePills(page: Page): Promise<string[]> {
  return page.evaluate((pastels: string[]) => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const cs = getComputedStyle(el)
      if (!pastels.includes(cs.backgroundColor)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden") continue
      if (el.closest("[data-status]")) continue
      out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} ${cs.backgroundColor}`)
    }
    return out
  }, [HEX.booting, HEX.installing, HEX.configuring, HEX.done] as string[])
}
