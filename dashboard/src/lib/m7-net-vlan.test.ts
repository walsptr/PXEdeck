// M7-T1 (backend-dev) — unit lib/net.ts: parser `PXE_VLAN_NETWORKS` (AC-7.1 bagian murni) dan
// validasi IP statis per VLAN terdaftar (AC-7.3, DEC-024 §4). VLAN null/tidak terdaftar → aturan &
// pesan DEC-006 identik (dibandingkan langsung dengan hasil subnet management).
import { describe, expect, it } from "vitest"

import {
  cidrsOverlap,
  isVlanNetwork,
  MAX_VLAN_NETWORKS,
  MGMT_NETWORK,
  planIps,
  resolveStaticNetwork,
  toNetworkResponse,
  validateIpAssignments,
  validateStaticIp,
  validateStaticNetwork,
  vlanNetworksFromEnv,
  type IpUsage,
  type MgmtNetwork,
  type VlanNetwork,
} from "./net"

/** Subnet PXE topologi M7 (VLAN 10 native). */
const PXE: MgmtNetwork = {
  cidr: "10.99.10.0/24",
  gateway: "10.99.10.1",
  dns: ["10.99.10.2"],
  pxeServer: "10.99.10.2",
  dynamicRange: ["10.99.10.100", "10.99.10.200"],
}
const V20: VlanNetwork = { vlan: 20, cidr: "10.99.20.0/24", prefix: 24, gateway: "10.99.20.1" }
const V30: VlanNetwork = { vlan: 30, cidr: "172.16.0.0/16", prefix: 16, gateway: "172.16.0.1" }
const usage = (entries: [string, string][] = []): IpUsage => ({ used: new Map(entries) })

describe("AC-7.1 vlanNetworksFromEnv (murni)", () => {
  it("satu entri → {vlan,cidr,prefix,gateway}", () => {
    expect(vlanNetworksFromEnv("20:10.99.20.0/24:10.99.20.1", PXE.cidr)).toEqual([V20])
  })
  it("CIDR dinormalisasi ke alamat network; spasi di tepi entri/field diterima", () => {
    expect(vlanNetworksFromEnv("20:10.99.20.7/24:10.99.20.1", PXE.cidr)).toEqual([V20])
    expect(vlanNetworksFromEnv(" 20 : 10.99.20.0/24 : 10.99.20.1 ; 30:172.16.5.5/16:172.16.0.1 ", PXE.cidr)).toEqual([V20, V30])
  })
  it("kosong / spasi / undefined → []", () => {
    expect(vlanNetworksFromEnv(undefined, PXE.cidr)).toEqual([])
    expect(vlanNetworksFromEnv("", PXE.cidr)).toEqual([])
    expect(vlanNetworksFromEnv("   ", PXE.cidr)).toEqual([])
  })
  it("tepat 16 entri diterima; 17 ditolak", () => {
    const entry = (i: number) => `${i + 1}:10.${i + 1}.0.0/24:10.${i + 1}.0.1`
    const sixteen = Array.from({ length: MAX_VLAN_NETWORKS }, (_, i) => entry(i)).join(";")
    expect(vlanNetworksFromEnv(sixteen, PXE.cidr)).toHaveLength(16)
    expect(() => vlanNetworksFromEnv(`${sixteen};17:10.17.0.0/24:10.17.0.1`, PXE.cidr)).toThrow(
      /^PXE_VLAN_NETWORKS maksimal 16 entri \(ada 17\)$/,
    )
  })
  it.each([
    ["VLAN 0", "0:10.99.20.0/24:10.99.20.1", /VLAN "0" harus bilangan bulat 1–4094/],
    ["VLAN 4095", "4095:10.99.20.0/24:10.99.20.1", /VLAN "4095" harus bilangan bulat 1–4094/],
    ["VLAN teks", "abc:10.99.20.0/24:10.99.20.1", /VLAN "abc"/],
    ["VLAN negatif", "-1:10.99.20.0/24:10.99.20.1", /VLAN "-1"/],
    ["VLAN desimal", "2.5:10.99.20.0/24:10.99.20.1", /VLAN "2\.5"/],
    ["VLAN ganda", "20:10.99.20.0/24:10.99.20.1;20:10.99.21.0/24:10.99.21.1", /entri #2: VLAN 20 ganda/],
    ["prefix /7", "20:10.0.0.0/7:10.0.0.1", /prefix \/7 harus 8–30/],
    ["prefix /31", "20:10.99.20.0/31:10.99.20.1", /prefix \/31 harus 8–30/],
    ["CIDR tanpa /prefix", "20:10.99.20.0:10.99.20.1", /entri #1: "10\.99\.20\.0" bukan CIDR IPv4/],
    ["CIDR tanpa prefix", "20:10.99.20.0/x:10.99.20.1", /"10\.99\.20\.0\/x" bukan CIDR IPv4/],
    ["gateway = network", "20:10.99.20.0/24:10.99.20.0", /gateway 10\.99\.20\.0 bukan alamat host di 10\.99\.20\.0\/24/],
    ["gateway = broadcast", "20:10.99.20.0/24:10.99.20.255", /gateway 10\.99\.20\.255 bukan alamat host/],
    ["gateway di luar CIDR", "20:10.99.20.0/24:10.99.21.1", /gateway 10\.99\.21\.1 bukan alamat host di 10\.99\.20\.0\/24/],
    ["gateway bukan IPv4", "20:10.99.20.0/24:gw", /gateway "gw" bukan IPv4/],
    ["tumpang tindih PXE_MGMT_CIDR", "10:10.99.10.0/24:10.99.10.1", /10\.99\.10\.0\/24 \(VLAN 10\) tumpang tindih dengan PXE_MGMT_CIDR 10\.99\.10\.0\/24/],
    ["superset PXE_MGMT_CIDR", "20:10.99.0.0/16:10.99.0.1", /tumpang tindih dengan PXE_MGMT_CIDR/],
    ["dua entri tumpang tindih", "20:10.99.20.0/24:10.99.20.1;30:10.99.20.128/25:10.99.20.129", /entri #2: 10\.99\.20\.128\/25 \(VLAN 30\) tumpang tindih dengan 10\.99\.20\.0\/24 \(VLAN 20\)/],
    ["pemisah koma", "20:10.99.20.0/24:10.99.20.1,30:10.99.30.0/24:10.99.30.1", /entri #1 .* harus berbentuk <vlan>:<cidr>:<gateway>/],
    ["entri kosong (;;)", "20:10.99.20.0/24:10.99.20.1;;30:10.99.30.0/24:10.99.30.1", /entri #2 kosong/],
    ["titik koma di akhir", "20:10.99.20.0/24:10.99.20.1;", /entri #2 kosong/],
    ["field kurang", "20:10.99.20.0/24", /harus berbentuk/],
  ])("%s → Error berawalan PXE_VLAN_NETWORKS", (_n, raw, msg) => {
    let err: Error | null = null
    try {
      vlanNetworksFromEnv(raw, PXE.cidr)
    } catch (e) {
      err = e as Error
    }
    expect(err).not.toBeNull()
    expect(err!.message.startsWith("PXE_VLAN_NETWORKS ")).toBe(true)
    expect(err!.message).toMatch(msg)
  })
  it("cidrsOverlap simetris; bersebelahan tidak tumpang tindih", () => {
    expect(cidrsOverlap("10.0.0.0/24", "10.0.1.0/24")).toBe(false)
    expect(cidrsOverlap("10.0.0.0/23", "10.0.1.0/24")).toBe(true)
    expect(cidrsOverlap("10.0.1.0/24", "10.0.0.0/23")).toBe(true)
  })
})

describe("resolveStaticNetwork (DEC-024 §4)", () => {
  it("VLAN terdaftar → jaringan VLAN; null/undefined/tidak terdaftar → subnet management", () => {
    expect(resolveStaticNetwork(20, PXE, [V20, V30])).toBe(V20)
    expect(resolveStaticNetwork(30, PXE, [V20, V30])).toBe(V30)
    expect(resolveStaticNetwork(null, PXE, [V20])).toBe(PXE)
    expect(resolveStaticNetwork(undefined, PXE, [V20])).toBe(PXE)
    expect(resolveStaticNetwork(99, PXE, [V20])).toBe(PXE)
    expect(resolveStaticNetwork(20, PXE)).toBe(PXE)
    expect(isVlanNetwork(V20)).toBe(true)
    expect(isVlanNetwork(PXE)).toBe(false)
  })
})

describe("AC-7.3 validasi IP statis VLAN terdaftar (VLAN 20)", () => {
  it("10.99.20.41/24 gw 10.99.20.1 → valid", () => {
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.99.20.1", dns: ["10.99.10.2", "1.1.1.1"] }, V20)).toEqual([])
    expect(validateStaticIp("10.99.20.41", usage(), V20)).toBeNull()
  })
  it("di luar subnet → pesan menyebut CIDR + VLAN", () => {
    expect(validateStaticIp("10.99.21.5", usage(), V20)).toBe("Di luar subnet 10.99.20.0/24 (VLAN 20)")
    expect(validateStaticIp("10.99.10.41", usage(), V20)).toBe("Di luar subnet 10.99.20.0/24 (VLAN 20)")
  })
  it(".0/.255 → network/broadcast; IP = gateway VLAN → ditolak", () => {
    expect(validateStaticIp("10.99.20.0", usage(), V20)).toBe("Alamat network/broadcast")
    expect(validateStaticIp("10.99.20.255", usage(), V20)).toBe("Alamat network/broadcast")
    expect(validateStaticIp("10.99.20.1", usage(), V20)).toBe("Dipakai gateway VLAN 20")
  })
  it("format/kosong tetap pesan lama", () => {
    expect(validateStaticIp("", usage(), V20)).toBe("IP wajib diisi")
    expect(validateStaticIp("10.99.20", usage(), V20)).toBe("Format IPv4 tidak valid")
  })
  it("prefix salah → pesan prefix VLAN; gateway di luar → pesan gateway VLAN", () => {
    expect(validateStaticNetwork({ prefix: 16, gateway: "10.99.20.1", dns: ["10.99.10.2"] }, V20)).toEqual([
      "Prefix /16 tidak sesuai subnet VLAN 20 10.99.20.0/24 (harus /24)",
    ])
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.99.10.1", dns: ["10.99.10.2"] }, V20)).toEqual([
      "Gateway 10.99.10.1 di luar subnet VLAN 20 10.99.20.0/24",
    ])
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.99.20.255", dns: ["10.99.10.2"] }, V20)).toEqual([
      "Gateway 10.99.20.255 di luar subnet VLAN 20 10.99.20.0/24",
    ])
    expect(validateStaticNetwork({ prefix: 24, gateway: "x", dns: ["10.99.10.2"] }, V20)).toEqual(["Gateway tidak valid"])
  })
  it("DNS tetap DEC-011 (bebas subnet, alamat khusus ditolak)", () => {
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.99.20.1", dns: ["8.8.8.8", "127.0.0.1"] }, V20)).toEqual([
      "DNS 127.0.0.1 adalah alamat loopback",
    ])
  })
  it("gateway payload boleh selain gateway VLAN asal host di CIDR VLAN", () => {
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.99.20.254", dns: ["10.99.10.2"] }, V20)).toEqual([])
  })
  it("bentrok mgmt_ip/lease host lain → Bentrok dengan …", () => {
    const u = usage([["10.99.20.42", "node42"], ["10.99.20.43", "lease node43"]])
    expect(validateStaticIp("10.99.20.42", u, V20)).toBe("Bentrok dengan node42")
    expect(validateStaticIp("10.99.20.43", u, V20)).toBe("Bentrok dengan lease node43")
  })
  it("tanpa aturan range DHCP: 10.99.20.150 (setara range PXE .100–.200) valid; IP = PXE server subnet lain tidak relevan", () => {
    expect(validateStaticIp("10.99.20.150", usage(), V20)).toBeNull()
    expect(validateStaticIp("10.99.20.2", usage(), V20)).toBeNull()
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.99.20.150", dns: ["10.99.10.2"] }, V20)).toEqual([])
  })
  it("planIps range .41–.44, 3 host, .42 terpakai, skipUsed → .41, .43, .44", () => {
    const rows = planIps(["a", "b", "c"], { kind: "range", start: "10.99.20.41", end: "10.99.20.44" }, usage([["10.99.20.42", "x"]]), true, V20)
    expect(rows).toEqual([
      { hostId: "a", ip: "10.99.20.41", error: null },
      { hostId: "b", ip: "10.99.20.43", error: null },
      { hostId: "c", ip: "10.99.20.44", error: null },
    ])
  })
  it("planIps tanpa skipUsed → error per host; mulai di gateway VLAN; IP awal di luar subnet VLAN", () => {
    const rows = planIps(["a", "b"], { kind: "range", start: "10.99.20.41", end: "10.99.20.44" }, usage([["10.99.20.42", "x"]]), false, V20)
    expect(rows[1]).toEqual({ hostId: "b", ip: "10.99.20.42", error: "Bentrok dengan x" })
    expect(planIps(["a"], { kind: "increment", start: "10.99.20.1", step: 1 }, usage(), false, V20)[0].error).toBe("Dipakai gateway VLAN 20")
    expect(planIps(["a"], { kind: "increment", start: "10.99.10.41", step: 1 }, usage(), true, V20)[0]).toEqual({
      hostId: "a",
      ip: null,
      error: "IP awal di luar subnet 10.99.20.0/24 (VLAN 20)",
    })
  })
  it("planIps VLAN /16: increment step 256 melewati batas oktet", () => {
    const rows = planIps(["a", "b"], { kind: "increment", start: "172.16.0.10", step: 256 }, usage(), true, V30)
    expect(rows.map((r) => r.ip)).toEqual(["172.16.0.10", "172.16.1.10"])
  })
  it("validateIpAssignments VLAN: duplikat batch + luar subnet per host", () => {
    const errs = validateIpAssignments(
      [
        { hostId: "a", ip: "10.99.20.41" },
        { hostId: "b", ip: "10.99.20.41" },
        { hostId: "c", ip: "10.99.10.41" },
      ],
      usage(),
      V20,
    )
    expect([...errs]).toEqual([
      ["b", "Duplikat dalam batch"],
      ["c", "Di luar subnet 10.99.20.0/24 (VLAN 20)"],
    ])
  })
})

describe("AC-7.3 regresi DEC-006: vlan null / VLAN 99 tidak terdaftar = subnet management apa adanya", () => {
  const VLANS = [V20]
  const cases = ["10.99.10.41", "10.99.20.41", "10.99.10.1", "10.99.10.2", "10.99.10.150", "10.99.10.0", "10.99.10.255", "x", ""]
  it.each([null, 99])("vlan=%s: validateStaticIp/validateStaticNetwork/planIps identik dengan subnet PXE", (vlan) => {
    const net = resolveStaticNetwork(vlan, PXE, VLANS)
    expect(net).toBe(PXE)
    for (const ip of cases) expect(validateStaticIp(ip, usage(), net)).toBe(validateStaticIp(ip, usage(), PXE))
    expect(validateStaticIp("10.99.20.41", usage(), net)).toBe("Di luar subnet 10.99.10.0/24")
    expect(validateStaticIp("10.99.10.150", usage(), net)).toBe("Di dalam range DHCP dinamis 10.99.10.100–10.99.10.200")
    expect(validateStaticIp("10.99.10.2", usage(), net)).toBe("Dipakai gateway/PXE server")
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.99.20.1", dns: ["10.99.10.2"] }, net)).toEqual([
      "Gateway 10.99.20.1 di luar subnet management 10.99.10.0/24",
    ])
    expect(validateStaticNetwork({ prefix: 16, gateway: "10.99.10.1", dns: ["10.99.10.2"] }, net)).toEqual([
      "Prefix /16 tidak sesuai subnet management 10.99.10.0/24 (harus /24)",
    ])
    expect(planIps(["a"], { kind: "increment", start: "10.99.20.41", step: 1 }, usage(), true, net)[0].error).toBe(
      "IP awal di luar subnet 10.99.10.0/24",
    )
  })
  it("default argumen tetap MGMT_NETWORK (pemanggil lama tanpa jaringan)", () => {
    expect(validateStaticIp("10.10.10.150")).toBe("Di dalam range DHCP dinamis 10.10.10.100–10.10.10.200")
    expect(validateStaticIp("10.10.10.41", undefined, "10.10.10.0/24")).toBeNull()
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.10.10.1", dns: ["10.10.10.1"] })).toEqual([])
    expect(resolveStaticNetwork(null, MGMT_NETWORK)).toBe(MGMT_NETWORK)
  })
})

describe("toNetworkResponse + vlanNetworks", () => {
  it("tanpa VLAN → bentuk M6 persis (tanpa kunci vlanNetworks)", () => {
    const r = toNetworkResponse(PXE)
    expect(Object.keys(r)).toEqual(["cidr", "prefix", "gateway", "dns", "dynamicRange", "pxeServer"])
    expect(toNetworkResponse(PXE, [])).toEqual(r)
  })
  it("dengan VLAN → vlanNetworks [{vlan,cidr,prefix,gateway}] (salinan)", () => {
    const list = [V20, V30]
    const r = toNetworkResponse(PXE, list)
    expect(r.vlanNetworks).toEqual([
      { vlan: 20, cidr: "10.99.20.0/24", prefix: 24, gateway: "10.99.20.1" },
      { vlan: 30, cidr: "172.16.0.0/16", prefix: 16, gateway: "172.16.0.1" },
    ])
    expect(r.vlanNetworks![0]).not.toBe(V20)
  })
})
