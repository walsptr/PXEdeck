// config-service langsung (store di-reset): atomisitas G3-2, prepareNewKeys, toPublicConfig.
import { beforeEach, describe, expect, it } from "vitest"

import { isolateEnv } from "@/test/env"
import { SSH_ED25519 } from "@/test/fixtures"

import { applyConfig, applyConfigPrepared, prepareNewKeys, toPublicConfig } from "./config-service"
import { getHost, resetMockStore } from "./mock-hosts"

isolateEnv({ PXE_MOCK_SIMULATION: "off" })
beforeEach(() => {
  resetMockStore("default")
})

describe("config-service", () => {
  it("toPublicConfig membuang passwordHash dan menambah hasPassword", () => {
    const pub = toPublicConfig({
      os: null,
      username: "u",
      passwordHash: "$6$x$y",
      sudo: true,
      disableSshPassword: false,
      network: { mode: "dhcp" },
      sshKeyIds: [],
      extraKeys: [],
      sshUser: null,
      updatedAt: null,
    })
    expect(pub).not.toHaveProperty("passwordHash")
    expect(pub.hasPassword).toBe(true)
  })

  it("prepareNewKeys: parse + fingerprint, error dibawa per key", async () => {
    const r = await prepareNewKeys([
      { name: "a", publicKey: SSH_ED25519.publicKey, saveToLibrary: false },
      { name: "b", publicKey: "sampah", saveToLibrary: false },
    ])
    expect(r[0]).toMatchObject({ ok: true, fingerprint: SSH_ED25519.fingerprint })
    expect(r[1]).toEqual({ ok: false, error: expect.stringMatching(/Tipe harus/) })
  })

  it("applyConfigPrepared menolak preparedKeys yang tidak sesuai", () => {
    expect(() =>
      applyConfigPrepared(["525400101011"], { ssh: { keyIds: [], newKeys: [{ name: "", publicKey: "x", saveToLibrary: false }], user: "" } }, []),
    ).toThrow(/preparedKeys/)
  })

  it("G3-2: dua request paralel dengan IP sama → hanya satu yang lolos", async () => {
    const net = (id: string) => ({
      network: {
        mode: "static" as const,
        assignments: { [id]: "10.10.10.88" },
        prefix: 24,
        gateway: "10.10.10.1",
        dns: ["10.10.10.1"],
        vlan: null,
        iface: { by: "mac" as const },
      },
      ssh: { keyIds: [], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" },
    })
    const [a, b] = await Promise.all([
      applyConfig(["b083fe5c19e2"], net("b083fe5c19e2")),
      applyConfig(["b083fe5c19e3"], net("b083fe5c19e3")),
    ])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    const ips = [getHost("b083fe5c19e2")!.mgmtIp, getHost("b083fe5c19e3")!.mgmtIp]
    expect(ips.filter((ip) => ip === "10.10.10.88")).toHaveLength(1)
  })

  it("id duplikat di hostIds disatukan", async () => {
    const r = await applyConfig(["525400101011", "525400101011"], { network: { mode: "dhcp" } })
    expect(r).toEqual({ ok: true, result: { updated: 1, generatedPasswords: undefined } })
  })
})
