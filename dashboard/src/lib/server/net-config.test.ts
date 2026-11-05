// DEC-006: getMgmtNetwork membaca env (di-cache per kombinasi nilai).
import { describe, expect, it } from "vitest"

import { isolateEnv } from "@/test/env"
import { MGMT_NETWORK } from "@/lib/net"

import { getMgmtNetwork } from "./net-config"

isolateEnv()

describe("getMgmtNetwork", () => {
  it("default lab tanpa env; env baru dibaca tanpa reload modul", () => {
    expect(getMgmtNetwork().cidr).toBe(MGMT_NETWORK.cidr)
    expect(getMgmtNetwork()).toBe(getMgmtNetwork())
    process.env.PXE_MGMT_CIDR = "10.99.0.0/24"
    process.env.PXE_MGMT_GATEWAY = "10.99.0.1"
    process.env.PXE_SERVER_IP = "10.99.0.2"
    process.env.PXE_DYNAMIC_RANGE = "10.99.0.100-10.99.0.200"
    expect(getMgmtNetwork()).toMatchObject({ cidr: "10.99.0.0/24", gateway: "10.99.0.1" })
  })
  it("env tidak konsisten → Error (fail fast)", () => {
    process.env.PXE_MGMT_CIDR = "10.99.0.0/24"
    expect(() => getMgmtNetwork()).toThrow(/PXE_MGMT_GATEWAY/)
  })
})
