// Logika form Sheet (M3-T3): initialForm, ipPlan, hostnamePlan, sectionErrors, buildPayload.
// Mendukung AC-3.12–3.14 (preview & validasi UI) di level unit.
import { describe, expect, it } from "vitest"

import { configPayload, type PublicHostConfig, type SectionKey } from "@/lib/host-config"
import type { Host } from "@/lib/types"

import {
  buildPayload,
  hostnamePlan,
  initialForm,
  ipPlan,
  ipUsageFor,
  sectionErrors,
  SECTION_LABEL,
  SECTION_ORDER,
  takenHostnames,
  type Context,
  type FormState,
} from "./form-state"

function host(p: Partial<Host> & { id: string; mac: string }): Host {
  return {
    hostname: null,
    currentIp: null,
    mgmtIp: null,
    vendor: null,
    firmware: "uefi",
    osInstalled: null,
    osAssigned: null,
    status: "discovered",
    statusSince: "2026-11-05T10:00:00.000Z",
    lastSeen: "2026-11-05T10:00:00.000Z",
    ...p,
  }
}

const A = host({ id: "aa0000000001", mac: "aa:00:00:00:00:01", hostname: "node01", currentIp: "10.10.10.11", mgmtIp: "10.10.10.11", osInstalled: "ubuntu-24.04.5", status: "done" })
const B = host({ id: "aa0000000002", mac: "aa:00:00:00:00:02", currentIp: "10.10.10.143" })
const C = host({ id: "aa0000000003", mac: "aa:00:00:00:00:03", currentIp: "10.10.10.144" })
const OTHER = host({ id: "bb0000000001", mac: "bb:00:00:00:00:01", hostname: "ctrl-01", currentIp: "10.10.10.21", mgmtIp: "10.10.10.21", status: "done" })
const LEASE = host({ id: "bb0000000002", mac: "bb:00:00:00:00:02", currentIp: "10.10.10.12" })
const OFF = host({ id: "bb0000000003", mac: "bb:00:00:00:00:03", hostname: "off", currentIp: "10.10.10.13", status: "offline" })
const ALL = [A, B, C, OTHER, LEASE, OFF]

const CONFIG: PublicHostConfig = {
  os: { osImageId: "rocky-9.4", disk: "/dev/sda", partition: "custom", customStorage: "x", timezone: "UTC", locale: "id_ID.UTF-8" },
  username: "ops",
  hasPassword: true,
  sudo: false,
  disableSshPassword: true,
  network: { mode: "static", ip: "10.10.10.11", prefix: 24, gateway: "10.10.10.1", dns: ["1.1.1.1"], vlan: 20, iface: { by: "name", name: "eno1" } },
  sshKeyIds: ["key-admin-wals"],
  extraKeys: [],
  sshUser: "ops",
  updatedAt: null,
}

const single: Context = { hosts: [A], allHosts: ALL, config: CONFIG }
const bulk: Context = { hosts: [B, C], allHosts: ALL }
const dirty = (...k: SectionKey[]) => new Set<SectionKey>(k)
function edit(f: FormState, patch: { [K in keyof FormState]?: Partial<FormState[K]> }): FormState {
  const out = { ...f }
  for (const k of Object.keys(patch) as (keyof FormState)[]) out[k] = { ...f[k], ...patch[k] } as never
  return out
}

describe("konstanta", () => {
  it("lima tab berurutan", () => {
    expect(SECTION_ORDER.map((k) => SECTION_LABEL[k])).toEqual(["OS", "Credentials", "Network", "Hostname", "SSH Keys"])
  })
})

describe("initialForm", () => {
  it("dari konfigurasi tersimpan (single host)", () => {
    const f = initialForm([A], CONFIG)
    expect(f.os).toMatchObject({ osImageId: "rocky-9.4", partition: "custom", customStorage: "x", timezone: "UTC", locale: "id_ID.UTF-8" })
    expect(f.credentials).toMatchObject({ mode: "same", username: "ops", password: "", sudo: false, disableSshPassword: true })
    expect(f.network).toMatchObject({ mode: "static", ip: "10.10.10.11", prefix: 24, dns: ["1.1.1.1"], vlan: "20", ifaceBy: "name", ifaceName: "eno1" })
    expect(f.hostname.name).toBe("node01")
    expect(f.ssh).toEqual({ keyIds: ["key-admin-wals"], newKeys: [], user: "ops" })
  })
  it("default tanpa konfigurasi (bulk)", () => {
    const f = initialForm([B, C])
    expect(f.os).toMatchObject({ osImageId: "", partition: "lvm", timezone: "Asia/Jakarta", locale: "en_US.UTF-8" })
    expect(f.credentials.username).toBe("ubuntu")
    expect(f.network).toMatchObject({ mode: "static", ip: "", prefix: 24, gateway: "10.10.10.1", dns: ["10.10.10.1"], vlan: "", ifaceBy: "mac", planKind: "range" })
    expect(f.hostname).toEqual({ name: "", template: "node-{index:02}", prefix: "", startIndex: 1 })
  })
  it("single tanpa config: OS & IP dari host; config dhcp", () => {
    const f = initialForm([host({ ...A, osInstalled: null, osAssigned: "debian-12" })], { ...CONFIG, os: null, network: { mode: "dhcp" } })
    expect(f.os.osImageId).toBe("debian-12")
    expect(f.network.mode).toBe("dhcp")
    expect(f.network.ip).toBe("10.10.10.11")
    expect(initialForm([A]).os.osImageId).toBe("ubuntu-24.04.5")
  })
})

describe("ipUsageFor / takenHostnames", () => {
  it("di luar batch; lease host offline diabaikan", () => {
    const u = ipUsageFor(bulk).used
    expect(u.get("10.10.10.21")).toBe("ctrl-01")
    expect(u.get("10.10.10.12")).toBe("lease bb:00:00:00:00:02")
    expect(u.has("10.10.10.13")).toBe(false)
    expect(u.has("10.10.10.143")).toBe(false)
    expect(takenHostnames(bulk).get("node01")).toBe("aa:00:00:00:00:01")
    expect(takenHostnames(single).has("node01")).toBe(false)
  })
})

describe("ipPlan (AC-3.14 preview)", () => {
  it("single: IP dari input divalidasi", () => {
    const f = initialForm([A], CONFIG).network
    expect(ipPlan(f, single)).toEqual([{ hostId: A.id, ip: "10.10.10.11", error: null }])
    expect(ipPlan({ ...f, ip: "10.10.10.21" }, single)[0].error).toBe("Bentrok dengan ctrl-01")
    expect(ipPlan({ ...f, ip: " " }, single)[0]).toEqual({ hostId: A.id, ip: null, error: "IP wajib diisi" })
  })
  it("bulk range melewati IP terpakai; increment", () => {
    const f = initialForm([B, C]).network
    // .11 = node01 (di luar batch), .12 = lease aktif; lease host offline (.13) tidak dihitung.
    expect(ipPlan({ ...f, start: "10.10.10.11", end: "10.10.10.99" }, bulk).map((r) => r.ip)).toEqual(["10.10.10.13", "10.10.10.14"])
    expect(ipPlan({ ...f, planKind: "increment", start: "10.10.10.30", step: 10 }, bulk).map((r) => r.ip)).toEqual(["10.10.10.30", "10.10.10.40"])
  })
})

describe("hostnamePlan (AC-3.14 preview)", () => {
  it("single: nama huruf kecil, dipakai host lain → error", () => {
    const f = initialForm([B])
    const ctx: Context = { hosts: [B], allHosts: ALL }
    expect(hostnamePlan(edit(f, { hostname: { name: " Web-1 " } }), dirty(), ctx)[0]).toEqual({ hostId: B.id, hostname: "web-1", error: null })
    expect(hostnamePlan(edit(f, { hostname: { name: "ctrl-01" } }), dirty(), ctx)[0].error).toBe("Sudah dipakai bb:00:00:00:00:01")
    expect(hostnamePlan(edit(f, { hostname: { name: "a_b" } }), dirty(), ctx)[0].error).toMatch(/Hanya a–z/)
  })
  it("bulk template; {ip_last_octet} memakai rencana IP bila network ikut disimpan", () => {
    const f = edit(initialForm([B, C]), { hostname: { template: "n-{ip_last_octet}" }, network: { start: "10.10.10.50", end: "10.10.10.60" } })
    expect(hostnamePlan(f, dirty("hostname"), bulk).map((r) => r.hostname)).toEqual(["n-143", "n-144"])
    expect(hostnamePlan(f, dirty("hostname", "network"), bulk).map((r) => r.hostname)).toEqual(["n-50", "n-51"])
    expect(hostnamePlan(edit(f, { network: { mode: "dhcp" } }), dirty("hostname", "network"), bulk).map((r) => r.hostname)).toEqual(["n-143", "n-144"])
  })
  it("bulk duplikat ditandai", () => {
    const f = edit(initialForm([B, C]), { hostname: { template: "same" } })
    expect(hostnamePlan(f, dirty(), bulk).map((r) => r.error)).toEqual([null, "Duplikat dalam batch"])
  })
})

describe("sectionErrors (AC-3.13 validasi UI)", () => {
  it("form default single yang valid → tanpa error", () => {
    expect(sectionErrors(initialForm([A], CONFIG), dirty(), single, null)).toEqual({})
  })
  it("OS: belum dipilih, disk invalid, custom kosong", () => {
    const f = edit(initialForm([B, C]), { os: { disk: "sda", partition: "custom", customStorage: " " } })
    expect(sectionErrors(f, dirty(), bulk, null).os).toEqual(["Pilih OS image", "Path disk harus seperti /dev/sda", "Isi konfigurasi storage custom"])
  })
  it("Credentials: username invalid, password pendek / wajib, CSV", () => {
    const base = initialForm([A], CONFIG)
    expect(sectionErrors(edit(base, { credentials: { username: "Root" } }), dirty(), single, null).credentials?.[0]).toMatch(/Huruf kecil/)
    expect(sectionErrors(edit(base, { credentials: { password: "short" } }), dirty(), single, null).credentials).toEqual(["Minimal 8 karakter"])
    // Single host tanpa password tersimpan / bulk → password wajib.
    expect(sectionErrors(base, dirty(), { ...single, config: { ...CONFIG, hasPassword: false } }, null).credentials).toEqual(["Password wajib diisi"])
    const b = initialForm([B, C])
    expect(sectionErrors(b, dirty(), bulk, null).credentials).toEqual(["Password wajib diisi"])
    expect(sectionErrors(edit(b, { credentials: { mode: "random" } }), dirty(), bulk, null).credentials).toBeUndefined()
    const csv = edit(b, { credentials: { mode: "csv" } })
    expect(sectionErrors(csv, dirty(), bulk, null).credentials).toEqual(["Tempel atau unggah CSV"])
    const filled = edit(b, { credentials: { mode: "csv", csv: "a,b,c" } })
    expect(sectionErrors(filled, dirty(), bulk, null).credentials).toEqual(["Validasi CSV dulu"])
    expect(sectionErrors(filled, dirty(), bulk, 2).credentials).toEqual(["2 baris CSV tidak valid"])
    expect(sectionErrors(filled, dirty(), bulk, 0).credentials).toBeUndefined()
  })
  it("Network: IP bentrok (single), host tanpa IP (bulk), prefix/gateway/DNS/VLAN/interface", () => {
    const s = edit(initialForm([A], CONFIG), { network: { ip: "10.10.10.21" } })
    expect(sectionErrors(s, dirty(), single, null).network).toEqual(["Bentrok dengan ctrl-01"])
    const b = edit(initialForm([B, C]), {
      network: { start: "10.10.10.13", end: "10.10.10.13", prefix: 16, gateway: "10.10.11.1", dns: [], vlan: "5000", ifaceBy: "name", ifaceName: "eth 0" },
    })
    const errs = sectionErrors(b, dirty(), bulk, null).network!
    expect(errs[0]).toBe("1 host belum dapat IP valid")
    expect(errs).toContain("Minimal satu DNS")
    expect(errs).toContain("VLAN ID 1–4094")
    expect(errs).toContain("Nama interface tidak valid")
    expect(errs.some((e) => /Prefix \/16/.test(e))).toBe(true)
    expect(errs.some((e) => /Gateway 10\.10\.11\.1 di luar subnet/.test(e))).toBe(true)
    expect(sectionErrors(edit(b, { network: { mode: "dhcp" } }), dirty(), bulk, null).network).toBeUndefined()
  })
  it("Hostname: single invalid, bulk jumlah invalid", () => {
    const s = edit(initialForm([A], CONFIG), { hostname: { name: "Bad_" } })
    expect(sectionErrors(s, dirty(), single, null).hostname?.[0]).toMatch(/Hanya a–z/)
    const b = edit(initialForm([B, C]), { hostname: { template: "x" } })
    expect(sectionErrors(b, dirty(), bulk, null).hostname).toEqual(["1 hostname tidak valid"])
  })
  it("SSH: tanpa key, user invalid, key baru kosong / tanpa nama", () => {
    const b = edit(initialForm([B, C]), { ssh: { user: "Root" } })
    expect(sectionErrors(b, dirty(), bulk, null).ssh).toEqual(["Pilih atau tambahkan minimal satu key", expect.stringMatching(/Huruf kecil/)])
    const k = edit(initialForm([B, C]), { ssh: { newKeys: [{ name: " ", publicKey: " ", saveToLibrary: true }] } })
    expect(sectionErrors(k, dirty(), bulk, null).ssh).toEqual(["Key baru #1 kosong", "Key baru #1: isi nama"])
  })
})

describe("buildPayload", () => {
  it("hanya bagian dirty; hasil lolos skema configPayload", () => {
    const f = initialForm([A], CONFIG)
    expect(buildPayload(f, dirty(), single)).toEqual({})
    const p = buildPayload(edit(f, { credentials: { password: "Secret-123" } }), dirty("os", "credentials", "network", "hostname", "ssh"), single)
    expect(p.os).toEqual({ osImageId: "rocky-9.4", disk: "/dev/sda", partition: "custom", customStorage: "x", timezone: "UTC", locale: "id_ID.UTF-8" })
    expect(p.credentials).toEqual({ mode: "same", username: "ops", password: "Secret-123", sudo: false, disableSshPassword: true })
    expect(p.network).toEqual({ mode: "static", assignments: { [A.id]: "10.10.10.11" }, prefix: 24, gateway: "10.10.10.1", dns: ["1.1.1.1"], vlan: 20, iface: { by: "name", name: "eno1" } })
    expect(p.hostname).toEqual({ assignments: { [A.id]: "node01" } })
    expect(p.ssh).toEqual({ keyIds: ["key-admin-wals"], newKeys: [], user: "ops" })
    expect(configPayload.safeParse(p).success).toBe(true)
  })
  it("bulk: random/csv credentials, dhcp, mac iface, customStorage hanya untuk custom, nama key dipangkas", () => {
    const f = initialForm([B, C])
    const r = buildPayload(edit(f, { credentials: { mode: "random", length: 24 }, os: { osImageId: "debian-12", disk: " /dev/vda " } }), dirty("credentials", "os"), bulk)
    expect(r.credentials).toEqual({ mode: "random", username: "ubuntu", length: 24, sudo: true, disableSshPassword: false })
    expect(r.os).toMatchObject({ disk: "/dev/vda", customStorage: undefined })
    const c = buildPayload(edit(f, { credentials: { mode: "csv", csv: "x" }, network: { mode: "dhcp" } }), dirty("credentials", "network"), bulk)
    expect(c.credentials).toEqual({ mode: "csv", csv: "x", sudo: true, disableSshPassword: false })
    expect(c.network).toEqual({ mode: "dhcp" })
    const n = buildPayload(edit(f, { network: { start: "10.10.10.13", end: "10.10.10.13" }, ssh: { newKeys: [{ name: " k ", publicKey: "p", saveToLibrary: true }] } }), dirty("network", "ssh"), bulk)
    expect(n.network).toMatchObject({ assignments: { [B.id]: "10.10.10.13", [C.id]: "" }, vlan: null, iface: { by: "mac" } })
    expect(n.ssh?.newKeys[0].name).toBe("k")
  })
})
