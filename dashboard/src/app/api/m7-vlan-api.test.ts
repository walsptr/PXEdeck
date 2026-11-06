// M7-T1 (backend-dev) — settings `PXE_VLAN_NETWORKS` (AC-7.1 bagian settings) + integration route
// handler (AC-7.2 GET /api/settings & /api/network, AC-7.4 PATCH host + POST bulk dengan VLAN
// terdaftar). DB demo (subnet management default 10.10.10.0/24); VLAN 20 = 10.99.20.0/24.
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

import { applyConfig } from "@/lib/server/config-service"
import { peekConfig } from "@/lib/server/db/repos/configs"
import { getHost, updateHost } from "@/lib/server/db/repos/hosts"
import { getStaticNetwork, getVlanNetworks } from "@/lib/server/net-config"
import { getSettings, SETTINGS_ENV_KEYS, settingsFromEnv, toSettingsResponse, type SettingsEnv } from "@/lib/server/settings"
import { dbSnapshot, withDb } from "@/test/db"
import { SSH_ED25519 } from "@/test/fixtures"
import { anonGetReq, ctx, getReq, jsonReq } from "@/test/route"

import { POST as bulk } from "./hosts/bulk/route"
import { PATCH } from "./hosts/[id]/route"
import { GET as networkGET } from "./network/route"
import { GET as settingsGET } from "./settings/route"

const VLAN_ENV = "20:10.99.20.0/24:10.99.20.1;30:10.99.30.0/24:10.99.30.1"
withDb("demo", { PXE_VLAN_NETWORKS: VLAN_ENV })

const DISC1 = "b083fe5c19e2" // discovered, lease 10.10.10.143
const DISC2 = "b083fe5c19e3"
const DISC3 = "a0369f0b725d"
const NODE01 = "525400101011"
const V20 = { vlan: 20, cidr: "10.99.20.0/24", prefix: 24, gateway: "10.99.20.1" }
const V30 = { vlan: 30, cidr: "10.99.30.0/24", prefix: 24, gateway: "10.99.30.1" }

const vlanNet = (assignments: Record<string, string>, over: Record<string, unknown> = {}) => ({
  mode: "static" as const,
  assignments,
  prefix: 24,
  gateway: "10.99.20.1",
  dns: ["10.10.10.1"],
  vlan: 20 as number | null,
  iface: { by: "mac" as const },
  ...over,
})
const patch = (id: string, network: unknown) => PATCH(jsonReq(`/api/hosts/${id}`, "PATCH", { network }), ctx(id))

async function expect422(res: Response, msg: RegExp) {
  expect(res.status).toBe(422)
  const body = await res.json()
  expect(body.errors.some((e: { section: string; message: string }) => e.section === "network" && msg.test(e.message))).toBe(true)
}

describe("AC-7.1 settings PXE_VLAN_NETWORKS", () => {
  it("settingsFromEnv: vlanNetworks terurai; kosong → []", () => {
    expect(settingsFromEnv({ PXE_VLAN_NETWORKS: VLAN_ENV }).vlanNetworks).toEqual([V20, V30])
    expect(settingsFromEnv({}).vlanNetworks).toEqual([])
    expect(settingsFromEnv({ PXE_VLAN_NETWORKS: "  " }).vlanNetworks).toEqual([])
  })
  it("tidak valid → Error 'Konfigurasi server tidak valid: PXE_VLAN_NETWORKS …' (fail fast)", () => {
    expect(() => settingsFromEnv({ PXE_VLAN_NETWORKS: "4095:10.99.20.0/24:10.99.20.1" })).toThrow(
      /^Konfigurasi server tidak valid: PXE_VLAN_NETWORKS entri #1: VLAN "4095"/,
    )
    // Tumpang tindih dengan PXE_MGMT_CIDR AKTIF (bukan default) — env management ikut diperiksa.
    const kvm: SettingsEnv = {
      PXE_MGMT_CIDR: "10.99.10.0/24",
      PXE_MGMT_GATEWAY: "10.99.10.1",
      PXE_SERVER_IP: "10.99.10.2",
      PXE_DHCP_RANGE: "10.99.10.100-10.99.10.200",
    }
    expect(() => settingsFromEnv({ ...kvm, PXE_VLAN_NETWORKS: "10:10.99.10.0/24:10.99.10.1" })).toThrow(
      /Konfigurasi server tidak valid: PXE_VLAN_NETWORKS .*tumpang tindih dengan PXE_MGMT_CIDR 10\.99\.10\.0\/24/,
    )
    expect(settingsFromEnv({ ...kvm, PXE_VLAN_NETWORKS: "20:10.99.20.0/24:10.99.20.1" }).vlanNetworks).toEqual([V20])
    // Default lab 10.10.10.0/24 juga diperiksa.
    expect(() => settingsFromEnv({ PXE_VLAN_NETWORKS: "20:10.10.0.0/16:10.10.0.1" })).toThrow(/PXE_MGMT_CIDR 10\.10\.10\.0\/24/)
  })
  it("SETTINGS_ENV_KEYS memuat PXE_VLAN_NETWORKS: ganti env → getSettings() berubah", () => {
    expect(SETTINGS_ENV_KEYS).toContain("PXE_VLAN_NETWORKS")
    const a = getSettings()
    expect(a.vlanNetworks).toEqual([V20, V30])
    process.env.PXE_VLAN_NETWORKS = "20:10.99.20.0/24:10.99.20.1"
    const b = getSettings()
    expect(b).not.toBe(a)
    expect(b.vlanNetworks).toEqual([V20])
    expect(getVlanNetworks()).toEqual([V20])
    expect(getStaticNetwork(20)).toEqual(V20)
    expect(getStaticNetwork(30)).toBe(b.network)
    expect(getStaticNetwork(null)).toBe(b.network)
    process.env.PXE_VLAN_NETWORKS = "x"
    expect(() => getSettings()).toThrow(/PXE_VLAN_NETWORKS/)
  })
  it("contoh (dikomentari) di .env.example valid dengan nilai .env.example lain", () => {
    const text = readFileSync(path.resolve(__dirname, "../../../.env.example"), "utf8")
    const m = /^# PXE_VLAN_NETWORKS=(.+)$/m.exec(text)
    expect(m).not.toBeNull()
    // Tidak aktif secara default (perilaku M6 utuh).
    expect(text).not.toMatch(/^PXE_VLAN_NETWORKS=/m)
    const env: SettingsEnv = {}
    for (const l of text.split("\n")) {
      const kv = /^([A-Z_]+)=(.*)$/.exec(l)
      if (kv && kv[2] !== "") env[kv[1]] = kv[2]
    }
    const s = settingsFromEnv({ ...env, PXE_DB_PATH: ":memory:", PXE_VLAN_NETWORKS: m![1] })
    expect(s.vlanNetworks.map((v) => v.vlan)).toEqual([20, 30])
  })
  it("toSettingsResponse: vlanNetworks hanya bila ada entri; field lain identik tanpa/dengan VLAN", () => {
    const without = toSettingsResponse(settingsFromEnv({}))
    const withV = toSettingsResponse(settingsFromEnv({ PXE_VLAN_NETWORKS: VLAN_ENV }))
    expect(without).not.toHaveProperty("vlanNetworks")
    expect(withV.vlanNetworks).toEqual([V20, V30])
    const rest: Partial<typeof withV> = { ...withV }
    delete rest.vlanNetworks
    expect(rest).toEqual(without)
  })
})

describe("AC-7.2 GET /api/settings & /api/network", () => {
  it("dengan env: kedua respons memuat vlanNetworks identik; no-store", async () => {
    const s = await settingsGET(getReq("/api/settings"))
    const n = await networkGET(getReq("/api/network"))
    expect(s.status).toBe(200)
    expect(n.status).toBe(200)
    expect(n.headers.get("cache-control")).toBe("no-store")
    const sb = await s.json()
    const nb = await n.json()
    expect(sb.vlanNetworks).toEqual([V20, V30])
    expect(nb).toEqual({
      cidr: "10.10.10.0/24",
      prefix: 24,
      gateway: "10.10.10.1",
      dns: ["10.10.10.1"],
      dynamicRange: ["10.10.10.100", "10.10.10.200"],
      pxeServer: "10.10.10.1",
      vlanNetworks: [V20, V30],
    })
  })
  it("tanpa env: tanpa kunci vlanNetworks (bentuk M6 persis)", async () => {
    delete process.env.PXE_VLAN_NETWORKS
    const nb = await (await networkGET(getReq("/api/network"))).json()
    const sb = await (await settingsGET(getReq("/api/settings"))).json()
    expect(nb).not.toHaveProperty("vlanNetworks")
    expect(sb).not.toHaveProperty("vlanNetworks")
    expect(Object.keys(nb)).toEqual(["cidr", "prefix", "gateway", "dns", "dynamicRange", "pxeServer"])
  })
  it("env tidak valid → 500 {error} menyebut PXE_VLAN_NETWORKS (kedua route)", async () => {
    process.env.PXE_VLAN_NETWORKS = "20:10.99.20.0/24:10.99.21.1"
    for (const res of [await networkGET(getReq("/api/network")), await settingsGET(getReq("/api/settings"))]) {
      expect(res.status).toBe(500)
      expect((await res.json()).error).toMatch(/PXE_VLAN_NETWORKS entri #1: gateway 10\.99\.21\.1/)
    }
  })
  it("tanpa sesi → 401 (regresi AC-6.7)", async () => {
    expect((await networkGET(anonGetReq("/api/network"))).status).toBe(401)
    expect((await settingsGET(anonGetReq("/api/settings"))).status).toBe(401)
  })
})

describe("AC-7.4 PATCH /api/hosts/:id + POST /api/hosts/bulk dengan VLAN terdaftar", () => {
  it("VLAN 20 + 10.99.20.41 → 200, tersimpan vlan 20, mgmt_ip 10.99.20.41", async () => {
    const res = await patch(DISC1, vlanNet({ [DISC1]: "10.99.20.41" }))
    expect(res.status).toBe(200)
    expect(getHost(DISC1)!.mgmtIp).toBe("10.99.20.41")
    expect(peekConfig(DISC1)!.network).toEqual({
      mode: "static",
      ip: "10.99.20.41",
      prefix: 24,
      gateway: "10.99.20.1",
      dns: ["10.10.10.1"],
      vlan: 20,
      iface: { by: "mac" },
    })
  })
  it.each([
    ["IP di luar subnet VLAN", vlanNet({ [DISC1]: "10.99.30.41" }), /: Di luar subnet 10\.99\.20\.0\/24 \(VLAN 20\)$/],
    ["IP subnet PXE dengan VLAN 20", vlanNet({ [DISC1]: "10.10.10.41" }), /: Di luar subnet 10\.99\.20\.0\/24 \(VLAN 20\)$/],
    ["prefix salah", vlanNet({ [DISC1]: "10.99.20.41" }, { prefix: 16 }), /^Prefix \/16 tidak sesuai subnet VLAN 20 10\.99\.20\.0\/24 \(harus \/24\)$/],
    ["gateway di luar", vlanNet({ [DISC1]: "10.99.20.41" }, { gateway: "10.10.10.1" }), /^Gateway 10\.10\.10\.1 di luar subnet VLAN 20 10\.99\.20\.0\/24$/],
    ["IP = gateway VLAN", vlanNet({ [DISC1]: "10.99.20.1" }), /: Dipakai gateway VLAN 20$/],
    ["IP = gateway payload", vlanNet({ [DISC1]: "10.99.20.254" }, { gateway: "10.99.20.254" }), /: Bentrok dengan gateway 10\.99\.20\.254$/],
    ["VLAN 99 tidak terdaftar + IP VLAN 20", vlanNet({ [DISC1]: "10.99.20.50" }, { vlan: 99 }), /: Di luar subnet 10\.10\.10\.0\/24$/],
    ["VLAN null + IP VLAN 20", vlanNet({ [DISC1]: "10.99.20.50" }, { vlan: null }), /: Di luar subnet 10\.10\.10\.0\/24$/],
    ["VLAN 30 + IP VLAN 20 (salah ketik)", vlanNet({ [DISC1]: "10.99.20.41" }, { vlan: 30, gateway: "10.99.30.1" }), /: Di luar subnet 10\.99\.30\.0\/24 \(VLAN 30\)$/],
  ])("%s → 422 section network, DB tidak berubah", async (_n, network, msg) => {
    const before = dbSnapshot()
    await expect422(await patch(DISC1, network), msg)
    expect(dbSnapshot()).toEqual(before)
  })
  it("bentrok mgmt_ip host lain (VLAN) dan lease aktif di subnet VLAN → 422", async () => {
    expect((await patch(DISC1, vlanNet({ [DISC1]: "10.99.20.41" }))).status).toBe(200)
    const before = dbSnapshot()
    await expect422(await patch(DISC2, vlanNet({ [DISC2]: "10.99.20.41" })), /: Bentrok dengan b0:83:fe:5c:19:e2$/)
    // Lease aktif (current_ip) host lain di subnet VLAN.
    updateHost(DISC3, { currentIp: "10.99.20.77" })
    const before2 = dbSnapshot()
    await expect422(await patch(DISC2, vlanNet({ [DISC2]: "10.99.20.77" })), /: Bentrok dengan lease a0:36:9f:0b:72:5d$/)
    expect(dbSnapshot()).toEqual(before2)
    expect(before2).not.toEqual(before)
  })
  it("VLAN null tetap DEC-006: IP subnet management diterima, range DHCP ditolak", async () => {
    expect((await patch(DISC1, vlanNet({ [DISC1]: "10.10.10.88" }, { vlan: null, gateway: "10.10.10.1" }))).status).toBe(200)
    await expect422(
      await patch(DISC2, vlanNet({ [DISC2]: "10.10.10.150" }, { vlan: 99, gateway: "10.10.10.1" })),
      /: Di dalam range DHCP dinamis 10\.10\.10\.100–10\.10\.10\.200$/,
    )
  })
  it("bulk 3 host VLAN 20 → IP tersimpan sesuai assignment; bulk dengan satu IP bentrok → 422 tanpa efek", async () => {
    const ids = [DISC1, DISC2, DISC3]
    const ips = ["10.99.20.41", "10.99.20.42", "10.99.20.43"]
    const assignments = Object.fromEntries(ids.map((id, i) => [id, ips[i]]))
    const ok = await bulk(jsonReq("/api/hosts/bulk", "POST", { hostIds: ids, network: vlanNet(assignments) }))
    expect(ok.status).toBe(200)
    expect(ids.map((id) => getHost(id)!.mgmtIp)).toEqual(ips)
    expect(ids.map((id) => (peekConfig(id)!.network as { vlan: number }).vlan)).toEqual([20, 20, 20])
    const before = dbSnapshot()
    const bad = await bulk(
      jsonReq("/api/hosts/bulk", "POST", {
        hostIds: [NODE01, DISC1],
        network: vlanNet({ [NODE01]: "10.99.20.42", [DISC1]: "10.99.20.60" }),
      }),
    )
    // DISC2 (di luar batch) memegang .42.
    await expect422(bad, /^node01: Bentrok dengan b0:83:fe:5c:19:e3$/)
    expect(dbSnapshot()).toEqual(before)
  })
  it("dua request paralel dengan IP VLAN sama → tepat satu sukses", async () => {
    const body = (id: string) => ({
      network: vlanNet({ [id]: "10.99.20.99" }),
      ssh: { keyIds: [], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" },
    })
    const results = await Promise.all([applyConfig([DISC1], body(DISC1)), applyConfig([DISC2], body(DISC2))])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect([getHost(DISC1)!.mgmtIp, getHost(DISC2)!.mgmtIp].filter((ip) => ip === "10.99.20.99")).toHaveLength(1)
  })
})
