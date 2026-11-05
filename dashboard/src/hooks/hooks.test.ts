// Hook data (jsdom): use-hosts, use-host-config, use-now, use-mobile. fetch di-stub.
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, configKey, useCsvImport, useHostConfig, useInstall, useSaveConfig, useSshKeys } from "./use-host-config"
import { HOSTS_KEY, HOSTS_POLL_MS, useDeleteHost, useHosts, useRebootHost } from "./use-hosts"
import { useIsMobile } from "./use-mobile"
import { serverClockOffset, syncServerClock, useNow } from "./use-now"

type Call = { url: string; init?: RequestInit }
let calls: Call[] = []
let responder: (url: string, init?: RequestInit) => Response

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return responder(url, init)
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

const json = (body: unknown, status = 200) => Response.json(body, { status })
const HOST = { id: "525400101011", mac: "52:54:00:10:10:11", hostname: "node01", status: "done" }

describe("use-hosts", () => {
  it("useHosts: GET /api/hosts, interval polling 5 dtk, sinkron jam server", async () => {
    const serverTime = new Date(Date.now() + 60_000).toISOString()
    responder = () => json({ hosts: [HOST], serverTime })
    const { wrapper } = setup()
    const { result } = renderHook(() => useHosts(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.hosts).toEqual([HOST])
    expect(calls[0].url).toBe("/api/hosts")
    expect(HOSTS_POLL_MS).toBe(5000)
    expect(Math.abs(serverClockOffset() - 60_000)).toBeLessThan(2000)
  })
  it("useHosts: error membawa pesan server; enabled=false tidak fetch", async () => {
    responder = () => json({ error: "rusak" }, 500)
    const { wrapper } = setup()
    const { result } = renderHook(() => useHosts(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe("rusak")
    responder = () => new Response("bukan json", { status: 503, statusText: "Service Unavailable" })
    const r2 = renderHook(() => useHosts(), { wrapper: setup().wrapper })
    await waitFor(() => expect(r2.result.current.isError).toBe(true))
    expect(r2.result.current.error?.message).toBe("503 Service Unavailable")
    calls = []
    renderHook(() => useHosts({ enabled: false }), { wrapper: setup().wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toHaveLength(0)
  })
  it("useDeleteHost: DELETE lalu buang host dari cache", async () => {
    responder = (url, init) => (init?.method === "DELETE" ? new Response(null, { status: 204 }) : json({ hosts: [], serverTime: new Date().toISOString() }))
    const { qc, wrapper } = setup()
    qc.setQueryData(HOSTS_KEY, { hosts: [HOST, { ...HOST, id: "x" }], serverTime: "" })
    const { result } = renderHook(() => useDeleteHost(), { wrapper })
    await act(() => result.current.mutateAsync("525400101011"))
    expect(calls[0]).toMatchObject({ url: "/api/hosts/525400101011", init: { method: "DELETE" } })
    const cached = qc.getQueryData<{ hosts: { id: string }[] }>(HOSTS_KEY)
    expect(cached?.hosts.find((h) => h.id === "525400101011")).toBeUndefined()
  })
  it("useDeleteHost tanpa cache; useRebootHost POST", async () => {
    responder = (url, init) => (init?.method === "DELETE" ? new Response(null, { status: 204 }) : json({ ...HOST, status: "booting" }))
    const { qc, wrapper } = setup()
    const del = renderHook(() => useDeleteHost(), { wrapper })
    await act(() => del.result.current.mutateAsync("abc"))
    expect(qc.getQueryData(HOSTS_KEY)).toBeUndefined()
    const reboot = renderHook(() => useRebootHost(), { wrapper })
    const h = await act(() => reboot.result.current.mutateAsync("525400101011"))
    expect(h).toMatchObject({ status: "booting" })
    expect(calls.at(-1)).toMatchObject({ url: "/api/hosts/525400101011/reboot", init: { method: "POST" } })
  })
})

describe("use-host-config", () => {
  it("useHostConfig & useSshKeys", async () => {
    responder = (url) => (url.endsWith("/config") ? json({ hasPassword: true }) : json([{ id: "k" }]))
    const { wrapper } = setup()
    const cfg = renderHook(() => useHostConfig("525400101011"), { wrapper })
    const keys = renderHook(() => useSshKeys(), { wrapper })
    await waitFor(() => expect(cfg.result.current.isSuccess && keys.result.current.isSuccess).toBe(true))
    expect(cfg.result.current.data).toEqual({ hasPassword: true })
    expect(keys.result.current.data).toEqual([{ id: "k" }])
    expect(configKey("x")).toEqual(["host-config", "x"])
    calls = []
    renderHook(() => useHostConfig(null), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toHaveLength(0)
  })
  it("useSaveConfig: single → PATCH, bulk → POST /api/hosts/bulk; 422 → ApiError dengan errors", async () => {
    responder = () => json({ updated: 1 })
    const { qc, wrapper } = setup()
    const spy = vi.spyOn(qc, "invalidateQueries")
    const { result } = renderHook(() => useSaveConfig(), { wrapper })
    await act(() => result.current.mutateAsync({ hostIds: ["a"], payload: { network: { mode: "dhcp" } } }))
    expect(calls[0].url).toBe("/api/hosts/a")
    expect(calls[0].init?.method).toBe("PATCH")
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ network: { mode: "dhcp" } })
    expect(spy).toHaveBeenCalledWith({ queryKey: configKey("a") })
    await act(() => result.current.mutateAsync({ hostIds: ["a", "b"], payload: {} }))
    expect(calls[1].url).toBe("/api/hosts/bulk")
    expect(JSON.parse(calls[1].init!.body as string)).toEqual({ hostIds: ["a", "b"] })
    responder = () => json({ error: "ditolak", errors: [{ section: "network", message: "x" }] }, 422)
    const err = await result.current.mutateAsync({ hostIds: ["a"], payload: {} }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ message: "ditolak", status: 422, errors: [{ section: "network", message: "x" }] })
    responder = () => new Response("x", { status: 500, statusText: "Internal Server Error" })
    const e2 = await result.current.mutateAsync({ hostIds: ["a"], payload: {} }).catch((e) => e)
    expect(e2).toMatchObject({ message: "500 Internal Server Error", errors: [] })
  })
  it("useInstall: single/bulk; 422 tetap mengembalikan hasil; error lain dilempar", async () => {
    responder = () => json({ started: ["a"], failed: [] })
    const { wrapper } = setup()
    const { result } = renderHook(() => useInstall(), { wrapper })
    expect(await act(() => result.current.mutateAsync(["a"]))).toEqual({ started: ["a"], failed: [] })
    expect(calls[0]).toMatchObject({ url: "/api/hosts/a/install", init: { method: "POST", body: undefined } })
    await act(() => result.current.mutateAsync(["a", "b"]))
    expect(calls[1].url).toBe("/api/hosts/bulk/install")
    responder = () => json({ started: [], failed: [{ hostId: "a", message: "m" }] }, 422)
    expect(await act(() => result.current.mutateAsync(["a"]))).toEqual({ started: [], failed: [{ hostId: "a", message: "m" }] })
    responder = () => json({ error: "id" }, 400)
    await expect(result.current.mutateAsync(["zz"])).rejects.toMatchObject({ status: 400 })
  })
  it("useCsvImport POST /api/credentials/import", async () => {
    responder = () => json({ rows: [], valid: 0, invalid: 0 })
    const { result } = renderHook(() => useCsvImport(), { wrapper: setup().wrapper })
    await act(() => result.current.mutateAsync({ csv: "a", hostIds: ["x"] }))
    expect(calls[0]).toMatchObject({ url: "/api/credentials/import", init: { method: "POST" } })
  })
})

describe("use-now", () => {
  it("syncServerClock: abaikan jitter < 1 dtk dan ISO invalid; useNow ikut offset & tick 15 dtk", () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse("2026-11-05T10:00:00Z"))
    const now = Date.now()
    syncServerClock(new Date(now).toISOString(), now)
    const base = serverClockOffset()
    syncServerClock(new Date(now + 500).toISOString(), now)
    expect(serverClockOffset()).toBe(base)
    syncServerClock("bukan tanggal", now)
    expect(serverClockOffset()).toBe(base)
    syncServerClock(new Date(now + 120_000).toISOString(), now)
    expect(serverClockOffset()).toBe(120_000)
    const { result, unmount } = renderHook(() => useNow())
    expect(result.current).toBe(now + 120_000)
    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(result.current).toBe(now + 15_000 + 120_000)
    unmount()
    syncServerClock(new Date(now).toISOString(), now)
  })
})

describe("use-mobile", () => {
  it("mengikuti matchMedia (max-width: 767px) dan berlangganan perubahan", () => {
    let matches = true
    const listeners = new Set<() => void>()
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches,
      media: q,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }))
    const { result, unmount } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
    matches = false
    act(() => listeners.forEach((l) => l()))
    expect(result.current).toBe(false)
    unmount()
    expect(listeners.size).toBe(0)
  })
})
