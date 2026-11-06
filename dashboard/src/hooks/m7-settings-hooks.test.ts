// M7-T6 hook (jsdom): `useActiveNetwork` membawa `vlanNetworks` dari `GET /api/settings`
// (key tidak ada = [], DEC-024 §4 / keputusan kompatibilitas M6).
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useActiveNetwork, vlanNetworksOf } from "./use-settings"

afterEach(() => vi.unstubAllGlobals())

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const w = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
  return w
}

const BASE = {
  cidr: "10.99.0.0/24",
  prefix: 24,
  gateway: "10.99.0.1",
  dns: ["10.99.0.2"],
  dynamicRange: ["10.99.0.100", "10.99.0.200"],
  pxeServer: "10.99.0.2",
}
const V20 = { vlan: 20, cidr: "10.99.20.0/24", prefix: 24, gateway: "10.99.20.1" }

describe("use-settings VLAN (M7-T6)", () => {
  it("vlanNetworksOf: key tidak ada → []; ada → apa adanya", () => {
    expect(vlanNetworksOf({ ...BASE, dynamicRange: ["10.99.0.100", "10.99.0.200"] })).toEqual([])
    expect(vlanNetworksOf({ ...BASE, dynamicRange: ["10.99.0.100", "10.99.0.200"], vlanNetworks: [V20] })).toEqual([V20])
  })

  it("useActiveNetwork: vlanNetworks dari settings, [] bila key tidak ada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...BASE, vlanNetworks: [V20] })))
    const a = renderHook(() => useActiveNetwork(), { wrapper: wrapper() })
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true))
    expect(a.result.current.data).toMatchObject({ cidr: "10.99.0.0/24", prefix: 24, vlanNetworks: [V20] })

    vi.stubGlobal("fetch", vi.fn(async () => Response.json(BASE)))
    const b = renderHook(() => useActiveNetwork(), { wrapper: wrapper() })
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true))
    expect(b.result.current.data?.vlanNetworks).toEqual([])
  })
})
