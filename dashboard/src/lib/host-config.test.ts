// Skema payload (validasi struktural, G3-4 LIMITS) + parseHostId.
import { describe, expect, it } from "vitest"

import { bulkPayload, configPayload, installPayload, LIMITS, parseHostId } from "./host-config"

const staticNet = {
  mode: "static",
  assignments: { "525400101011": "10.10.10.50" },
  prefix: 24,
  gateway: "10.10.10.1",
  dns: ["10.10.10.1"],
  vlan: null,
  iface: { by: "mac" },
}

describe("parseHostId", () => {
  it("12 hex → huruf kecil; selain itu null", () => {
    expect(parseHostId(" 525400ABCDEF ")).toBe("525400abcdef")
    expect(parseHostId("52:54:00:ab:cd:ef")).toBeNull()
    expect(parseHostId("525400abcde")).toBeNull()
  })
})

describe("skema configPayload", () => {
  it("payload lengkap valid", () => {
    const r = configPayload.safeParse({
      os: { osImageId: "ubuntu-24.04.5", disk: "/dev/sda", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
      credentials: { mode: "same", username: "ops", password: "x", sudo: true, disableSshPassword: false },
      network: staticNet,
      hostname: { assignments: { "525400101011": "node-01" } },
      ssh: { keyIds: [], newKeys: [], user: "" },
    })
    expect(r.success).toBe(true)
  })
  it.each([
    ["prefix 40", { network: { ...staticNet, prefix: 40 } }, "network"],
    ["disk bukan /dev", { os: { osImageId: "x", disk: "sda", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" } }, "os"],
    ["mode credentials asing", { credentials: { mode: "ldap", sudo: true, disableSshPassword: false } }, "credentials"],
    ["random length 8", { credentials: { mode: "random", username: "a", length: 8, sudo: true, disableSshPassword: false } }, "credentials"],
    ["iface name invalid", { network: { ...staticNet, iface: { by: "name", name: "eth 0" } } }, "network"],
    ["DNS kosong", { network: { ...staticNet, dns: [] } }, "network"],
    ["IP > 15 char", { network: { ...staticNet, assignments: { a: "1".repeat(16) } } }, "network"],
    ["hostname > 63", { hostname: { assignments: { a: "a".repeat(64) } } }, "hostname"],
    ["keyIds > 100", { ssh: { keyIds: Array(101).fill("k"), newKeys: [], user: "" } }, "ssh"],
  ])("%s → ditolak pada bagian yang benar", (_n, payload, section) => {
    const r = configPayload.safeParse(payload)
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].path[0]).toBe(section)
  })
  it("assignments > LIMITS.hosts ditolak", () => {
    const assignments = Object.fromEntries(Array.from({ length: LIMITS.hosts + 1 }, (_, i) => [`h${i}`, "node"]))
    expect(configPayload.safeParse({ hostname: { assignments } }).success).toBe(false)
  })
})

describe("skema bulk/install", () => {
  it("hostIds kosong / terlalu banyak / id terlalu panjang ditolak", () => {
    expect(bulkPayload.safeParse({ hostIds: [] }).success).toBe(false)
    expect(bulkPayload.safeParse({ hostIds: Array(LIMITS.hosts + 1).fill("a") }).success).toBe(false)
    expect(installPayload.safeParse({ hostIds: ["x".repeat(65)] }).success).toBe(false)
    expect(installPayload.safeParse({ hostIds: ["525400101011"] }).success).toBe(true)
  })
})
