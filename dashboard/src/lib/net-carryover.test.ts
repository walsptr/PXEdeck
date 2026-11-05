// Carry-over gate M3 → M4 (wajib diperiksa di gate M4):
//  - CR-3-15: budget planIps untuk subnet env nyata yang besar (mis. /8) — tidak melebihi
//    MAX_PLAN_CANDIDATES maupun ukuran subnet.
import { describe, expect, it } from "vitest"

import { MAX_PLAN_CANDIDATES, mgmtNetworkFromEnv, planIps, type IpUsage } from "./net"

const NET8 = mgmtNetworkFromEnv({
  PXE_MGMT_CIDR: "10.0.0.0/8",
  PXE_MGMT_GATEWAY: "10.0.0.1",
  PXE_SERVER_IP: "10.0.0.2",
  PXE_DYNAMIC_RANGE: "10.0.0.100-10.0.0.200",
})

describe("CR-3-15 planIps budget", () => {
  it("subnet /8 dengan semua IP terpakai: berhenti setelah MAX_PLAN_CANDIDATES kandidat (bukan jutaan)", () => {
    let checked = 0
    // Map palsu yang menghitung pemeriksaan bentrok: setiap kandidat "terpakai".
    const used = new Map<string, string>()
    const usage: IpUsage = {
      used: { get: (ip: string) => (checked++, used.get(ip) ?? "host lain") } as unknown as Map<string, string>,
    }
    const t0 = Date.now()
    const rows = planIps(["a", "b"], { kind: "increment", start: "10.0.1.0", step: 1 }, usage, true, NET8)
    expect(rows).toEqual([
      { hostId: "a", ip: null, error: "Range IP tidak cukup" },
      { hostId: "b", ip: null, error: "Range IP tidak cukup" },
    ])
    expect(checked).toBeLessThanOrEqual(MAX_PLAN_CANDIDATES)
    expect(checked).toBeGreaterThan(MAX_PLAN_CANDIDATES - 1000)
    expect(Date.now() - t0).toBeLessThan(5_000)
  })
  it("subnet /24: budget = ukuran subnet (256), bukan MAX_PLAN_CANDIDATES", () => {
    let checked = 0
    const usage: IpUsage = { used: { get: () => (checked++, "x") } as unknown as Map<string, string> }
    planIps(["a"], { kind: "increment", start: "10.10.10.1", step: 1 }, usage, true)
    expect(checked).toBeLessThanOrEqual(256)
  })
})
