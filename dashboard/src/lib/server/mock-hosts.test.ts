// AC-2.3 (store mock, fake timers) + AC-2.4 (deleteHost, rebootToPxe) + seam DEC-005.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isolateEnv } from "@/test/env"
import { lookupVendor } from "@/lib/oui"

import {
  defaultConfig,
  deleteHost,
  getConfig,
  getHost,
  listHosts,
  mockDb,
  mockOptionsFromEnv,
  rebootToPxe,
  resetMockStore,
  startInstall,
} from "./mock-hosts"

const T0 = Date.parse("2026-11-05T10:00:00.000Z")
const SEC = 1000

isolateEnv()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  resetMockStore("default")
})
afterEach(() => {
  vi.useRealTimers()
})

describe("AC-2.3 store mock", () => {
  it("setelah reset: 14 host seed, id = MAC tanpa ':', vendor = OUI", () => {
    const hosts = listHosts()
    expect(hosts).toHaveLength(14)
    for (const h of hosts) {
      expect(h.id).toBe(h.mac.replaceAll(":", ""))
      expect(h.id).toMatch(/^[0-9a-f]{12}$/)
      expect(h.vendor).toBe(lookupVendor(h.mac))
    }
    expect(new Set(hosts.map((h) => h.id)).size).toBe(14)
  })

  it("booting → installing (20 dtk) → configuring (+60) → done (+20); OS dipindah", () => {
    const id = "3ca82a10447c" // legacy-01 (done, debian)
    // Beri OS tugasan lalu mulai dari booting tepat di T0.
    const s = mockDb()
    startInstall(s, s.hosts.get(id)!, "ubuntu-24.04.5")
    expect(getHost(id)!.status).toBe("booting")

    vi.setSystemTime(T0 + 19 * SEC)
    expect(getHost(id)!.status).toBe("booting")
    vi.setSystemTime(T0 + 20 * SEC)
    expect(getHost(id)!.status).toBe("installing")

    vi.setSystemTime(T0 + 79 * SEC)
    expect(getHost(id)!.status).toBe("installing")
    vi.setSystemTime(T0 + 80 * SEC)
    expect(getHost(id)!.status).toBe("configuring")

    vi.setSystemTime(T0 + 99 * SEC)
    expect(getHost(id)!.status).toBe("configuring")
    vi.setSystemTime(T0 + 100 * SEC)
    const done = getHost(id)!
    expect(done.status).toBe("done")
    expect(done.osInstalled).toBe("ubuntu-24.04.5")
    expect(done.osAssigned).toBeNull()
    expect(done.statusSince).toBe(new Date(T0 + 100 * SEC).toISOString())
    // Setelah install, IP saat ini = IP management.
    expect(done.currentIp).toBe(done.mgmtIp)
  })

  it("discovery menambah host `discovered` tiap 40 dtk sampai maks 4", () => {
    expect(listHosts()).toHaveLength(14)
    vi.setSystemTime(T0 + 39 * SEC)
    expect(listHosts()).toHaveLength(14)
    vi.setSystemTime(T0 + 40 * SEC)
    let hosts = listHosts()
    expect(hosts).toHaveLength(15)
    const fresh = hosts.find((h) => h.mac === "f8:bc:12:3a:00:61")!
    expect(fresh.status).toBe("discovered")
    expect(fresh.vendor).toBe("Dell")
    expect(fresh.lastSeen).toBe(new Date(T0 + 40 * SEC).toISOString())
    vi.setSystemTime(T0 + 80 * SEC)
    expect(listHosts()).toHaveLength(16)
    vi.setSystemTime(T0 + 160 * SEC)
    expect(listHosts()).toHaveLength(18)
    vi.setSystemTime(T0 + 3600 * SEC)
    hosts = listHosts()
    expect(hosts).toHaveLength(18)
    expect(hosts.filter((h) => h.status === "discovered")).toHaveLength(3 + 4)
  })

  it("discovery tidak menambah ulang host yang sudah ada", () => {
    // Host pool ke-3 (0c:c4:7a:91:5e:12) dibuat lebih dulu → tetap satu entri.
    const s = mockDb()
    const base = s.hosts.get("0cc47a915e10")!
    s.hosts.set("0cc47a915e12", { ...base, id: "0cc47a915e12", mac: "0c:c4:7a:91:5e:12" })
    vi.setSystemTime(T0 + 200 * SEC)
    const hosts = listHosts()
    expect(hosts.filter((h) => h.id === "0cc47a915e12")).toHaveLength(1)
    expect(hosts).toHaveLength(15 + 3)
  })

  it("lease host online diperbarui bila last seen > 3 menit", () => {
    const id = "52540010101" + "1" // node01, done
    vi.setSystemTime(T0 + 10 * 60 * SEC)
    const h = getHost(id)!
    expect(Date.parse(h.lastSeen)).toBeGreaterThan(T0 + 10 * 60 * SEC - 31 * SEC)
    // Host offline/failed tidak diperbarui.
    expect(getHost("9440c96e01ab")!.lastSeen).toBe(new Date(T0 - 5 * 60 * 60 * SEC).toISOString())
  })

  it("listHosts mengembalikan salinan (mutasi hasil tidak mengubah store)", () => {
    const hosts = listHosts()
    hosts[0].hostname = "diubah"
    hosts[0].status = "failed"
    hosts.pop()
    const again = listHosts()
    expect(again).toHaveLength(14)
    expect(again[0].hostname).not.toBe("diubah")
    const one = getHost(again[0].id)!
    one.hostname = "x"
    expect(getHost(again[0].id)!.hostname).not.toBe("x")
  })
})

describe("seam DEC-005", () => {
  it("PXE_MOCK_SIMULATION=off: tanpa tick tahap maupun discovery", () => {
    process.env.PXE_MOCK_SIMULATION = "off"
    resetMockStore("default")
    vi.setSystemTime(T0 + 3600 * SEC)
    const hosts = listHosts()
    expect(hosts).toHaveLength(14)
    expect(hosts.find((h) => h.id === "0cc47a915e10")!.status).toBe("booting")
  })

  it("PXE_MOCK_DISCOVER_EVERY_MS memperpendek interval discovery", () => {
    process.env.PXE_MOCK_DISCOVER_EVERY_MS = "2000"
    resetMockStore("default")
    vi.setSystemTime(T0 + 2 * SEC)
    expect(listHosts()).toHaveLength(15)
  })

  it("seed empty: tanpa host dan tanpa key; PXE_MOCK_SEED dipakai sebagai default", () => {
    const s = resetMockStore("empty")
    expect(listHosts()).toEqual([])
    expect(s.sshKeys.size).toBe(0)
    process.env.PXE_MOCK_SEED = "empty"
    process.env.PXE_MOCK_SIMULATION = "off"
    resetMockStore()
    expect(listHosts()).toEqual([])
    process.env.PXE_MOCK_SEED = "default"
    expect(resetMockStore().sshKeys.size).toBe(1)
  })

  it("store lama tanpa field baru dibangun ulang", () => {
    const g = globalThis as { __pxeMockStore?: unknown }
    g.__pxeMockStore = { hosts: new Map(), startedAt: 0, discovered: 0 }
    expect(listHosts()).toHaveLength(14)
  })

  it("mockOptionsFromEnv", () => {
    expect(mockOptionsFromEnv({})).toEqual({ simulation: true, discoverEveryMs: 40000, seed: "default" })
    for (const v of ["off", "0", "false", " OFF "])
      expect(mockOptionsFromEnv({ PXE_MOCK_SIMULATION: v }).simulation).toBe(false)
    expect(mockOptionsFromEnv({ PXE_MOCK_SIMULATION: "on" }).simulation).toBe(true)
    expect(mockOptionsFromEnv({ PXE_MOCK_DISCOVER_EVERY_MS: "1500" }).discoverEveryMs).toBe(1500)
    for (const v of ["0", "-5", "abc", "1.5", ""])
      expect(mockOptionsFromEnv({ PXE_MOCK_DISCOVER_EVERY_MS: v }).discoverEveryMs).toBe(40000)
    expect(mockOptionsFromEnv({ PXE_MOCK_SEED: "EMPTY" }).seed).toBe("empty")
    expect(mockOptionsFromEnv({ PXE_MOCK_SEED: "lain" }).seed).toBe("default")
  })
})

describe("AC-2.4 deleteHost & rebootToPxe", () => {
  it("deleteHost menghapus host + konfigurasinya", () => {
    const s = mockDb()
    const h = s.hosts.get("525400101011")!
    getConfig(s, h)
    expect(s.configs.has(h.id)).toBe(true)
    expect(deleteHost(h.id)).toBe(true)
    expect(getHost(h.id)).toBeNull()
    expect(mockDb().configs.has(h.id)).toBe(false)
    expect(listHosts()).toHaveLength(13)
  })

  it("deleteHost id tak dikenal → false", () => {
    expect(deleteHost("000000000000")).toBe(false)
    expect(listHosts()).toHaveLength(14)
  })

  it("rebootToPxe: osAssigned ada → booting; statusSince/lastSeen diperbarui", () => {
    vi.setSystemTime(T0 + 5 * SEC)
    const h = rebootToPxe("ac1f6b227d40")! // compute-03, failed, osAssigned ubuntu
    expect(h.status).toBe("booting")
    const now = new Date(T0 + 5 * SEC).toISOString()
    expect(h.statusSince).toBe(now)
    expect(h.lastSeen).toBe(now)
    expect(getHost("ac1f6b227d40")!.status).toBe("booting")
  })

  it("rebootToPxe: tanpa osAssigned → discovered", () => {
    const h = rebootToPxe("3ca82a10447c")! // legacy-01
    expect(h.status).toBe("discovered")
  })

  it("rebootToPxe id tak dikenal → null", () => {
    expect(rebootToPxe("ffffffffffff")).toBeNull()
  })
})

describe("defaultConfig", () => {
  it("host terpasang: OS, user ubuntu, hash, key admin, network statis dari subnet management", () => {
    const h = getHost("525400101011")!
    const c = defaultConfig(h)
    expect(c.os?.osImageId).toBe("ubuntu-24.04.5")
    expect(c.username).toBe("ubuntu")
    expect(c.passwordHash).toMatch(/^\$6\$/)
    expect(c.sshKeyIds).toEqual(["key-admin-wals"])
    expect(c.network).toMatchObject({ mode: "static", ip: "10.10.10.11", prefix: 24, gateway: "10.10.10.1" })
  })
  it("host discovered: tanpa OS/credentials, network DHCP", () => {
    const c = defaultConfig(getHost("b083fe5c19e2")!)
    expect(c.os).toBeNull()
    expect(c.username).toBeNull()
    expect(c.passwordHash).toBeNull()
    expect(c.sshKeyIds).toEqual([])
    expect(c.network).toEqual({ mode: "dhcp" })
  })
  it("mengikuti env PXE_MGMT_* (DEC-006)", () => {
    process.env.PXE_MGMT_CIDR = "10.99.0.0/24"
    process.env.PXE_MGMT_GATEWAY = "10.99.0.1"
    process.env.PXE_SERVER_IP = "10.99.0.2"
    process.env.PXE_DYNAMIC_RANGE = "10.99.0.100-10.99.0.200"
    const c = defaultConfig(getHost("525400101011")!)
    expect(c.network).toMatchObject({ gateway: "10.99.0.1", dns: ["10.99.0.1"] })
  })
})
