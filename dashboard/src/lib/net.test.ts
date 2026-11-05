// AC-3.1: net (isIpv4, validateStaticIp, planIps, validateIpAssignments) + DEC-006.
import { describe, expect, it } from "vitest"

import {
  MGMT_NETWORK,
  fromNetworkResponse,
  inSubnet,
  intToIp,
  ipToInt,
  isCidr,
  isHostInSubnet,
  isIpv4,
  mgmtNetworkFromEnv,
  parseCidr,
  planIps,
  subnetBounds,
  toNetworkResponse,
  validateIpAssignments,
  validateStaticIp,
  validateStaticNetwork,
  type IpUsage,
} from "./net"

const usage = (entries: [string, string][] = []): IpUsage => ({ used: new Map(entries) })

describe("AC-3.1 isIpv4", () => {
  it("menolak 256.1.1.1, 01.2.3.4, 1.2.3", () => {
    for (const bad of ["256.1.1.1", "01.2.3.4", "1.2.3", "1.2.3.4.5", "a.b.c.d", "", "1.2.3.-1"])
      expect(isIpv4(bad), bad).toBe(false)
  })
  it("menerima IPv4 valid (spasi di tepi dipangkas)", () => {
    for (const ok of ["0.0.0.0", "10.10.10.11", "255.255.255.255", " 192.168.1.1 "])
      expect(isIpv4(ok), ok).toBe(true)
  })
})

describe("utilitas subnet", () => {
  it("ipToInt/intToIp round-trip", () => {
    for (const ip of ["0.0.0.0", "10.10.10.11", "255.255.255.255"]) expect(intToIp(ipToInt(ip))).toBe(ip)
  })
  it("parseCidr / subnetBounds / inSubnet / isCidr / isHostInSubnet", () => {
    expect(parseCidr("10.10.10.77/24")).toEqual({ network: ipToInt("10.10.10.0"), prefix: 24 })
    expect(parseCidr("0.0.0.0/0")).toEqual({ network: 0, prefix: 0 })
    expect(subnetBounds("10.10.10.0/24")).toMatchObject({ broadcast: ipToInt("10.10.10.255") })
    expect(inSubnet("10.10.11.1", "10.10.10.0/24")).toBe(false)
    expect(isCidr("10.0.0.0/8")).toBe(true)
    expect(isCidr("10.0.0.0/33")).toBe(false)
    expect(isCidr("10.0.0.0")).toBe(false)
    expect(isHostInSubnet("10.10.10.0", "10.10.10.0/24")).toBe(false)
    expect(isHostInSubnet("10.10.10.255", "10.10.10.0/24")).toBe(false)
    expect(isHostInSubnet("x", "10.10.10.0/24")).toBe(false)
    expect(isHostInSubnet("10.10.10.5", "10.10.10.0/24")).toBe(true)
  })
})

describe("AC-3.1 validateStaticIp (pesan berbeda per aturan)", () => {
  it("menolak tiap kasus dengan pesan berbeda", () => {
    const u = usage([["10.10.10.21", "ctrl-01"]])
    const msgs = {
      empty: validateStaticIp("", u),
      format: validateStaticIp("10.10.10", u),
      outside: validateStaticIp("10.10.11.5", u),
      network: validateStaticIp("10.10.10.0", u),
      broadcast: validateStaticIp("10.10.10.255", u),
      gateway: validateStaticIp("10.10.10.1", u),
      dynamic: validateStaticIp("10.10.10.150", u),
      used: validateStaticIp("10.10.10.21", u),
    }
    expect(msgs.empty).toBe("IP wajib diisi")
    expect(msgs.format).toBe("Format IPv4 tidak valid")
    expect(msgs.outside).toBe("Di luar subnet 10.10.10.0/24")
    expect(msgs.network).toBe("Alamat network/broadcast")
    expect(msgs.broadcast).toBe("Alamat network/broadcast")
    expect(msgs.gateway).toBe("Dipakai gateway/PXE server")
    expect(msgs.dynamic).toBe("Di dalam range DHCP dinamis 10.10.10.100–10.10.10.200")
    expect(msgs.used).toBe("Bentrok dengan ctrl-01")
    const distinct = new Set(Object.entries(msgs).filter(([k]) => k !== "broadcast").map(([, v]) => v))
    expect(distinct.size).toBe(7)
  })
  it("PXE server terpisah dari gateway juga ditolak", () => {
    const net = { ...MGMT_NETWORK, pxeServer: "10.10.10.2" }
    expect(validateStaticIp("10.10.10.2", undefined, net)).toBe("Dipakai gateway/PXE server")
  })
  it("IP valid → null; subnet sebagai string CIDR", () => {
    expect(validateStaticIp("10.10.10.50")).toBeNull()
    expect(validateStaticIp("10.10.20.50", undefined, "10.10.0.0/16")).toBeNull()
  })
})

describe("AC-3.1 planIps", () => {
  const ids = ["a", "b", "c"]
  it("mode range menghasilkan pemetaan berurutan", () => {
    expect(planIps(ids, { kind: "range", start: "10.10.10.11", end: "10.10.10.20" }, usage(), true)).toEqual([
      { hostId: "a", ip: "10.10.10.11", error: null },
      { hostId: "b", ip: "10.10.10.12", error: null },
      { hostId: "c", ip: "10.10.10.13", error: null },
    ])
  })
  it("mode increment memakai step", () => {
    const rows = planIps(ids, { kind: "increment", start: "10.10.10.10", step: 5 }, usage(), true)
    expect(rows.map((r) => r.ip)).toEqual(["10.10.10.10", "10.10.10.15", "10.10.10.20"])
    const s0 = planIps(["a", "b"], { kind: "increment", start: "10.10.10.10", step: 0 }, usage(), true)
    expect(s0.map((r) => r.ip)).toEqual(["10.10.10.10", "10.10.10.11"])
  })
  it("skipUsed=true melewati IP terpakai", () => {
    const rows = planIps(ids, { kind: "range", start: "10.10.10.11", end: "10.10.10.20" }, usage([["10.10.10.12", "x"]]), true)
    expect(rows.map((r) => r.ip)).toEqual(["10.10.10.11", "10.10.10.13", "10.10.10.14"])
    expect(rows.every((r) => r.error === null)).toBe(true)
  })
  it("skipUsed=false menandai error per host", () => {
    const rows = planIps(ids, { kind: "range", start: "10.10.10.11", end: "10.10.10.20" }, usage([["10.10.10.12", "x"]]), false)
    expect(rows[1]).toEqual({ hostId: "b", ip: "10.10.10.12", error: "Bentrok dengan x" })
    expect(rows[0].error).toBeNull()
    expect(rows[2]).toEqual({ hostId: "c", ip: "10.10.10.13", error: null })
  })
  it('range habis → "Range IP tidak cukup"', () => {
    const rows = planIps(ids, { kind: "range", start: "10.10.10.11", end: "10.10.10.12" }, usage(), true)
    expect(rows[2]).toEqual({ hostId: "c", ip: null, error: "Range IP tidak cukup" })
    const tail = planIps(ids, { kind: "increment", start: "10.10.10.253", step: 1 }, usage(), true)
    expect(tail[2].error).toBe("Range IP tidak cukup")
  })
  it("IP awal/akhir tidak valid", () => {
    expect(planIps(["a"], { kind: "range", start: "x", end: "10.10.10.2" }, usage(), true)[0].error).toBe("IP awal tidak valid")
    expect(planIps(["a"], { kind: "range", start: "10.10.10.11", end: "y" }, usage(), true)[0].error).toBe("IP akhir tidak valid")
  })
})

describe("AC-3.1 validateIpAssignments", () => {
  it("mendeteksi duplikat dalam batch dan bentrok", () => {
    const errs = validateIpAssignments(
      [
        { hostId: "a", ip: "10.10.10.11" },
        { hostId: "b", ip: "10.10.10.11" },
        { hostId: "c", ip: "10.10.10.21" },
        { hostId: "d", ip: "10.10.10.30" },
      ],
      usage([["10.10.10.21", "ctrl-01"]]),
    )
    expect(errs.get("a")).toBeUndefined()
    expect(errs.get("b")).toBe("Duplikat dalam batch")
    expect(errs.get("c")).toBe("Bentrok dengan ctrl-01")
    expect(errs.has("d")).toBe(false)
  })
})

describe("DEC-006 validateStaticNetwork", () => {
  it("valid → []", () => {
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.10.10.1", dns: ["1.1.1.1"] })).toEqual([])
  })
  it("prefix berbeda, gateway invalid/di luar subnet, DNS invalid", () => {
    expect(validateStaticNetwork({ prefix: 16, gateway: "10.10.10.1", dns: [] })[0]).toMatch(/Prefix \/16 .*harus \/24/)
    expect(validateStaticNetwork({ prefix: 24, gateway: "nope", dns: [] })).toEqual(["Gateway tidak valid"])
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.10.11.1", dns: [] })[0]).toMatch(/di luar subnet/)
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.10.10.1", dns: ["8.8.8.8", "x"] })).toEqual(["DNS tidak valid: x"])
  })
})

describe("DEC-006 mgmtNetworkFromEnv", () => {
  it("tanpa env → default", () => {
    expect(mgmtNetworkFromEnv({})).toEqual({ ...MGMT_NETWORK, dns: [...MGMT_NETWORK.dns] })
  })
  it("subnet KVM lengkap", () => {
    const n = mgmtNetworkFromEnv({
      PXE_MGMT_CIDR: "10.99.0.7/24",
      PXE_MGMT_GATEWAY: "10.99.0.1",
      PXE_SERVER_IP: "10.99.0.2",
      PXE_DYNAMIC_RANGE: "10.99.0.100,10.99.0.200",
    })
    expect(n).toEqual({
      cidr: "10.99.0.0/24",
      gateway: "10.99.0.1",
      dns: ["10.99.0.1"],
      pxeServer: "10.99.0.2",
      dynamicRange: ["10.99.0.100", "10.99.0.200"],
    })
    expect(mgmtNetworkFromEnv({ PXE_MGMT_DNS: "1.1.1.1, 8.8.8.8" }).dns).toEqual(["1.1.1.1", "8.8.8.8"])
  })
  it("kombinasi tidak konsisten melempar Error yang menyebut variabelnya", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ PXE_MGMT_CIDR: "bukan" }, /PXE_MGMT_CIDR/],
      [{ PXE_MGMT_CIDR: "10.0.0.0/31" }, /harus 8–30/],
      [{ PXE_MGMT_CIDR: "10.99.0.0/24" }, /PXE_MGMT_GATEWAY/],
      [{ PXE_SERVER_IP: "10.20.0.2" }, /PXE_SERVER_IP/],
      [{ PXE_MGMT_DNS: "x" }, /PXE_MGMT_DNS/],
      [{ PXE_MGMT_DNS: "1.1.1.1,1.1.1.2,1.1.1.3,1.1.1.4,1.1.1.5" }, /PXE_MGMT_DNS/],
      [{ PXE_DYNAMIC_RANGE: "10.10.10.100" }, /awal-akhir/],
      [{ PXE_DYNAMIC_RANGE: "10.10.20.1-10.10.20.9" }, /di luar subnet/],
      [{ PXE_DYNAMIC_RANGE: "10.10.10.200-10.10.10.100" }, /terbalik/],
    ]
    for (const [env, re] of cases) expect(() => mgmtNetworkFromEnv(env), JSON.stringify(env)).toThrow(re)
  })
})

// ---- Iterasi 2 ----

const KVM_NET = {
  cidr: "10.99.0.0/24",
  gateway: "10.99.0.1",
  dns: ["10.99.0.1"],
  pxeServer: "10.99.0.2",
  dynamicRange: ["10.99.0.100", "10.99.0.200"] as const,
}

describe("iter2 CR-3-1 planIps: IP awal di luar subnet ditolak tanpa loop", () => {
  it("di bawah network (range & increment) → semua host error 'IP awal di luar subnet <cidr>'", () => {
    for (const spec of [
      { kind: "range" as const, start: "10.0.0.0", end: "10.10.10.20" },
      { kind: "increment" as const, start: "10.0.0.0", step: 1 },
      { kind: "range" as const, start: "1.1.1.1", end: "10.10.10.99" },
    ]) {
      expect(planIps(["a", "b", "c"], spec, usage(), true), JSON.stringify(spec)).toEqual([
        { hostId: "a", ip: null, error: "IP awal di luar subnet 10.10.10.0/24" },
        { hostId: "b", ip: null, error: "IP awal di luar subnet 10.10.10.0/24" },
        { hostId: "c", ip: null, error: "IP awal di luar subnet 10.10.10.0/24" },
      ])
    }
  })
  it("di atas broadcast dan dengan subnet aktif non-default", () => {
    expect(planIps(["a"], { kind: "increment", start: "10.10.11.5", step: 1 }, usage(), true)).toEqual([
      { hostId: "a", ip: null, error: "IP awal di luar subnet 10.10.10.0/24" },
    ])
    expect(planIps(["a"], { kind: "range", start: "10.10.10.11", end: "10.10.10.20" }, usage(), true, KVM_NET)).toEqual([
      { hostId: "a", ip: null, error: "IP awal di luar subnet 10.99.0.0/24" },
    ])
    expect(planIps(["a"], { kind: "range", start: "10.99.0.11", end: "10.99.0.20" }, usage(), true, KVM_NET)).toEqual([
      { hostId: "a", ip: "10.99.0.11", error: null },
    ])
  })
  it("jarak jauh ke subnet (1.1.1.1, 0.0.0.1) selesai < 50 ms (tanpa iterasi linear)", () => {
    const t = performance.now()
    for (let i = 0; i < 20; i++) {
      planIps(["a", "b", "c"], { kind: "increment", start: "1.1.1.1", step: 1 }, usage(), true)
      planIps(["a", "b", "c"], { kind: "range", start: "0.0.0.1", end: "10.10.10.99" }, usage(), true)
    }
    expect(performance.now() - t).toBeLessThan(50)
  })
  it("iterasi dibatasi ukuran subnet: semua IP terpakai → 'Range IP tidak cukup'", () => {
    const net = { ...MGMT_NETWORK, cidr: "10.10.10.0/29", dynamicRange: ["10.10.10.6", "10.10.10.6"] as const }
    const used = usage([["10.10.10.2", "x"], ["10.10.10.3", "y"], ["10.10.10.4", "z"], ["10.10.10.5", "w"]])
    const rows = planIps(["a"], { kind: "increment", start: "10.10.10.2", step: 1 }, used, true, net)
    expect(rows).toEqual([{ hostId: "a", ip: null, error: "Range IP tidak cukup" }])
  })
})

describe("iter2 CR-3-9 validateStaticNetwork: gateway di range DHCP dinamis ditolak", () => {
  it("gateway .150 (default lab) dan batas range", () => {
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.10.10.150", dns: ["1.1.1.1"] })).toEqual([
      "Gateway 10.10.10.150 di dalam range DHCP dinamis 10.10.10.100–10.10.10.200",
    ])
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.10.10.100", dns: [] })).toHaveLength(1)
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.10.10.200", dns: [] })).toHaveLength(1)
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.10.10.99", dns: [] })).toEqual([])
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.10.10.201", dns: [] })).toEqual([])
  })
  it("memakai range dinamis subnet aktif", () => {
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.99.0.150", dns: [] }, KVM_NET)).toEqual([
      "Gateway 10.99.0.150 di dalam range DHCP dinamis 10.99.0.100–10.99.0.200",
    ])
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.99.0.1", dns: [] }, KVM_NET)).toEqual([])
  })
})

describe("iter2 CR-3-2 NetworkResponse", () => {
  it("toNetworkResponse menambah prefix; fromNetworkResponse kebalikannya", () => {
    const r = toNetworkResponse(KVM_NET)
    expect(r).toEqual({
      cidr: "10.99.0.0/24",
      prefix: 24,
      gateway: "10.99.0.1",
      dns: ["10.99.0.1"],
      dynamicRange: ["10.99.0.100", "10.99.0.200"],
      pxeServer: "10.99.0.2",
    })
    expect(fromNetworkResponse(r)).toEqual({ ...KVM_NET, dynamicRange: ["10.99.0.100", "10.99.0.200"] })
    // Salinan, bukan referensi ke array internal.
    expect(r.dns).not.toBe(KVM_NET.dns)
    expect(toNetworkResponse(MGMT_NETWORK).prefix).toBe(24)
  })
})
