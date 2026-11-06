// M7-T6 (§2.5c, AC-7.10/7.11 di level unit): form Network VLAN-aware — resolusi jaringan VLAN
// terdaftar, isi otomatis prefix/gateway/range, validasi klien dan pratinjau bulk.
import { describe, expect, it } from "vitest"

import type { PublicHostConfig, SectionKey } from "@/lib/host-config"
import type { VlanNetwork } from "@/lib/net"
import type { Host } from "@/lib/types"

import {
  buildPayload,
  defaultIpRange,
  initialForm,
  ipPlan,
  parseVlan,
  requiredPrefix,
  sectionErrors,
  staticNetworkOf,
  vlanNetworksOf,
  vlanPatch,
  type Context,
  type FormNetwork,
  type NetForm,
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
    statusSince: "2026-11-06T10:00:00.000Z",
    lastSeen: "2026-11-06T10:00:00.000Z",
    ...p,
  }
}

const V20: VlanNetwork = { vlan: 20, cidr: "10.99.20.0/24", prefix: 24, gateway: "10.99.20.1" }
const V30: VlanNetwork = { vlan: 30, cidr: "10.30.0.0/16", prefix: 16, gateway: "10.30.0.1" }
const MGMT = {
  cidr: "10.99.0.0/24",
  gateway: "10.99.0.1",
  dns: ["10.99.0.2"],
  pxeServer: "10.99.0.2",
  dynamicRange: ["10.99.0.100", "10.99.0.200"] as const,
}
const NET: FormNetwork = { ...MGMT, vlanNetworks: [V20, V30] }

const N1 = host({ id: "n1", mac: "52:54:00:99:00:41" })
const N2 = host({ id: "n2", mac: "52:54:00:99:00:42" })
const N3 = host({ id: "n3", mac: "52:54:00:99:00:43" })
const USED = host({ id: "u1", mac: "52:54:00:99:00:50", hostname: "vlan-used", mgmtIp: "10.99.20.42", status: "done" })

const single = (net: FormNetwork = NET): Context => ({ hosts: [N1], allHosts: [N1, USED], net })
const bulk = (net: FormNetwork = NET): Context => ({ hosts: [N1, N2, N3], allHosts: [N1, N2, N3, USED], net })

function form(ctx: Context, p: Partial<NetForm> = {}): NetForm {
  return { ...initialForm(ctx.hosts, undefined, ctx.net).network, ...p }
}

describe("resolusi jaringan VLAN (DEC-024 §4)", () => {
  it("parseVlan: kosong/teks → null, angka → number", () => {
    expect(parseVlan("")).toBeNull()
    expect(parseVlan("  ")).toBeNull()
    expect(parseVlan("2a")).toBeNull()
    expect(parseVlan("20")).toBe(20)
    expect(parseVlan(" 4094 ")).toBe(4094)
  })

  it("vlanNetworksOf: key tidak ada → []", () => {
    expect(vlanNetworksOf({ hosts: [], allHosts: [] })).toEqual([])
    expect(vlanNetworksOf({ hosts: [], allHosts: [], net: { ...MGMT } })).toEqual([])
    expect(vlanNetworksOf(single())).toEqual([V20, V30])
  })

  it("staticNetworkOf: VLAN terdaftar → jaringan VLAN; kosong/tidak terdaftar → management", () => {
    expect(staticNetworkOf({ vlan: "20" }, single())).toBe(V20)
    expect(staticNetworkOf({ vlan: "30" }, single())).toBe(V30)
    expect(staticNetworkOf({ vlan: "" }, single())).toBe(NET)
    expect(staticNetworkOf({ vlan: "99" }, single())).toBe(NET)
    // Tanpa daftar VLAN (server tanpa PXE_VLAN_NETWORKS) → selalu management.
    expect(staticNetworkOf({ vlan: "20" }, single({ ...MGMT }))).toEqual({ ...MGMT })
  })

  it("defaultIpRange VLAN: .11 sampai sebelum broadcast (tanpa range DHCP); management tetap", () => {
    expect(defaultIpRange(V20)).toEqual({ start: "10.99.20.11", end: "10.99.20.254" })
    expect(defaultIpRange(V30)).toEqual({ start: "10.30.0.11", end: "10.30.255.254" })
    expect(defaultIpRange(NET)).toEqual({ start: "10.99.0.11", end: "10.99.0.99" })
  })

  it("requiredPrefix: prefix VLAN atau prefix CIDR management", () => {
    expect(requiredPrefix(V30)).toBe(16)
    expect(requiredPrefix(NET)).toBe(24)
  })

  it("initialForm: config tersimpan ber-VLAN terdaftar → range default dari VLAN", () => {
    const cfg = {
      network: { mode: "static", ip: "10.99.20.41", prefix: 24, gateway: "10.99.20.1", dns: ["10.99.0.2"], vlan: 20, iface: { by: "mac" } },
    } as unknown as PublicHostConfig
    const f = initialForm([N1], cfg, NET).network
    expect(f.vlan).toBe("20")
    expect(f.start).toBe("10.99.20.11")
    expect(f.end).toBe("10.99.20.254")
    expect(initialForm([N1], undefined, NET).network.start).toBe("10.99.0.11")
  })
})

describe("vlanPatch: isi otomatis bila belum diubah pengguna (§2.5c)", () => {
  it("VLAN terdaftar diketik → prefix, gateway, range bulk dari jaringan VLAN", () => {
    const ctx = bulk()
    expect(vlanPatch(form(ctx), "30", ctx)).toEqual({
      vlan: "30",
      prefix: 16,
      gateway: "10.30.0.1",
      start: "10.30.0.11",
      end: "10.30.255.254",
    })
  })

  it("gateway/prefix/range yang diubah manual tidak ditimpa", () => {
    const ctx = bulk()
    const f = form(ctx, { vlan: "20", prefix: 24, gateway: "10.99.20.254", start: "10.99.20.41", end: "10.99.20.44" })
    expect(vlanPatch(f, "30", ctx)).toEqual({ vlan: "30", prefix: 16 })
    const g = form(ctx, { prefix: 23 })
    expect(vlanPatch(g, "20", ctx)).toEqual({
      vlan: "20",
      gateway: "10.99.20.1",
      start: "10.99.20.11",
      end: "10.99.20.254",
    })
  })

  it("VLAN dikosongkan → default subnet PXE kembali", () => {
    const ctx = bulk()
    const f = form(ctx, { ...vlanPatch(form(ctx), "30", ctx) })
    expect(vlanPatch(f, "", ctx)).toEqual({
      vlan: "",
      prefix: 24,
      gateway: "10.99.0.1",
      start: "10.99.0.11",
      end: "10.99.0.99",
    })
  })

  it("VLAN tidak terdaftar / mengetik digit pertama → hanya vlan berubah", () => {
    const ctx = single()
    expect(vlanPatch(form(ctx), "2", ctx)).toEqual({ vlan: "2" })
    expect(vlanPatch(form(ctx), "99", ctx)).toEqual({ vlan: "99" })
    // Tanpa VLAN terdaftar di server → perilaku lama (tidak ada isi otomatis).
    const plain = single({ ...MGMT })
    expect(vlanPatch(form(plain), "20", plain)).toEqual({ vlan: "20" })
  })
})

describe("validasi klien & pratinjau dengan jaringan VLAN (AC-7.10/7.11 unit)", () => {
  it("single: IP di luar subnet VLAN, gateway VLAN, IP terpakai; IP valid", () => {
    const ctx = single()
    const f = form(ctx, { ...vlanPatch(form(ctx), "20", ctx) })
    expect(ipPlan({ ...f, ip: "10.99.10.41" }, ctx)[0].error).toBe("Di luar subnet 10.99.20.0/24 (VLAN 20)")
    expect(ipPlan({ ...f, ip: "10.99.20.1" }, ctx)[0].error).toBe("Dipakai gateway VLAN 20")
    expect(ipPlan({ ...f, ip: "10.99.20.42" }, ctx)[0].error).toBe("Bentrok dengan vlan-used")
    expect(ipPlan({ ...f, ip: "10.99.20.150" }, ctx)[0].error).toBeNull()
    expect(ipPlan({ ...f, ip: "10.99.20.41" }, ctx)[0]).toEqual({ hostId: "n1", ip: "10.99.20.41", error: null })
  })

  it("bulk range .41–.44 dengan .42 terpakai + skipUsed → .41, .43, .44", () => {
    const ctx = bulk()
    const f = form(ctx, { ...vlanPatch(form(ctx), "20", ctx), start: "10.99.20.41", end: "10.99.20.44", skipUsed: true })
    expect(ipPlan(f, ctx).map((r) => r.ip)).toEqual(["10.99.20.41", "10.99.20.43", "10.99.20.44"])
    // Default range VLAN langsung menghasilkan pratinjau dari .11.
    const d = form(ctx, { ...vlanPatch(form(ctx), "20", ctx) })
    expect(ipPlan(d, ctx).map((r) => r.ip)).toEqual(["10.99.20.11", "10.99.20.12", "10.99.20.13"])
    expect(ipPlan({ ...d, start: "10.99.0.11" }, ctx)[0].error).toBe("IP awal di luar subnet 10.99.20.0/24 (VLAN 20)")
  })

  it("sectionErrors memakai jaringan VLAN: prefix dan gateway", () => {
    const ctx = single()
    const dirty = new Set<SectionKey>(["network"])
    const base = initialForm(ctx.hosts, undefined, ctx.net)
    const f = { ...base, network: { ...base.network, ...vlanPatch(base.network, "20", ctx), ip: "10.99.20.41" } }
    expect(sectionErrors(f, dirty, ctx, null).network).toBeUndefined()
    const bad = { ...f, network: { ...f.network, prefix: 16, gateway: "10.99.10.1" } }
    expect(sectionErrors(bad, dirty, ctx, null).network).toEqual([
      "Prefix /16 tidak sesuai subnet VLAN 20 10.99.20.0/24 (harus /24)",
      "Gateway 10.99.10.1 di luar subnet VLAN 20 10.99.20.0/24",
    ])
  })

  it("VLAN tidak terdaftar → aturan DEC-006 (subnet PXE) dan pesannya", () => {
    const ctx = single()
    const dirty = new Set<SectionKey>(["network"])
    const base = initialForm(ctx.hosts, undefined, ctx.net)
    const f = { ...base, network: { ...base.network, vlan: "99", ip: "10.99.20.50" } }
    expect(sectionErrors(f, dirty, ctx, null).network).toEqual(["Di luar subnet 10.99.0.0/24"])
  })

  it("buildPayload: vlan + assignments dari pratinjau VLAN", () => {
    const ctx = bulk()
    const base = initialForm(ctx.hosts, undefined, ctx.net)
    const f = { ...base, network: { ...base.network, ...vlanPatch(base.network, "20", ctx), start: "10.99.20.41", end: "10.99.20.44" } }
    const p = buildPayload(f, new Set<SectionKey>(["network"]), ctx)
    expect(p.network).toMatchObject({
      mode: "static",
      vlan: 20,
      prefix: 24,
      gateway: "10.99.20.1",
      assignments: { n1: "10.99.20.41", n2: "10.99.20.43", n3: "10.99.20.44" },
    })
  })
})
