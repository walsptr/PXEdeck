// M4-T8 hook (jsdom): use-settings (AC-4.6), use-server-status (AC-4.7), use-os-images (AC-4.27
// OS tab: image tidak tersedia/Windows). fetch di-stub.
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useNow } from "./use-now"
import { installBlockReason, OS_IMAGES_KEY, useOsImages, type OsImageInfo } from "./use-os-images"
import { SERVER_STATUS_KEY, SERVER_STATUS_POLL_MS, useServerStatus } from "./use-server-status"
import { SETTINGS_KEY, useActiveNetwork, useSettings } from "./use-settings"

let calls: { url: string; init?: RequestInit }[] = []
let responder: (url: string) => Response

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return responder(url)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const w = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
  return { qc, w }
}
const json = (body: unknown, status = 200) => Response.json(body, { status })

const SETTINGS = {
  cidr: "10.99.0.0/24",
  prefix: 24,
  gateway: "10.99.0.1",
  dns: ["10.99.0.2"],
  dynamicRange: ["10.99.0.100", "10.99.0.200"],
  pxeServer: "10.99.0.2",
  interface: "pxe0",
  baseUrl: "http://10.99.0.2",
  mediaUrl: "http://10.99.0.2/media",
  tftpRoot: "/srv/pxe/tftp",
  tokenTtlMin: 360,
  unknownHostAction: "local",
}

describe("use-settings (AC-4.6)", () => {
  it("GET /api/settings no-store; useActiveNetwork memakai cache yang sama", async () => {
    responder = () => json(SETTINGS)
    const { qc, w } = wrapper()
    const a = renderHook(() => useSettings(), { wrapper: w })
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true))
    expect(a.result.current.data).toEqual(SETTINGS)
    expect(calls).toEqual([{ url: "/api/settings", init: { cache: "no-store" } }])
    const b = renderHook(() => useActiveNetwork(), { wrapper: w })
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true))
    expect(b.result.current.data).toMatchObject({ cidr: "10.99.0.0/24", gateway: "10.99.0.1", pxeServer: "10.99.0.2", dynamicRange: ["10.99.0.100", "10.99.0.200"] })
    expect(calls).toHaveLength(1)
    expect(qc.getQueryData(SETTINGS_KEY)).toEqual(SETTINGS)
  })
  it("error: pesan server, atau status bila body bukan JSON", async () => {
    responder = () => json({ error: "PXE_BASE_URL harus http" }, 500)
    const a = renderHook(() => useSettings(), { wrapper: wrapper().w })
    await waitFor(() => expect(a.result.current.isError).toBe(true))
    expect(a.result.current.error?.message).toBe("PXE_BASE_URL harus http")
    responder = () => new Response("x", { status: 502, statusText: "Bad Gateway" })
    const b = renderHook(() => useSettings(), { wrapper: wrapper().w })
    await waitFor(() => expect(b.result.current.isError).toBe(true))
    expect(b.result.current.error?.message).toBe("502 Bad Gateway")
  })
})

describe("use-server-status (AC-4.7)", () => {
  it("GET /api/server-status, polling 15 dtk; error membawa pesan", async () => {
    const body = { services: [{ name: "DHCP", state: "online", online: true, detail: "x" }], checkedAt: "2026-11-05T10:00:00.000Z" }
    responder = () => json(body)
    const { qc, w } = wrapper()
    const r = renderHook(() => useServerStatus(), { wrapper: w })
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true))
    expect(r.result.current.data).toEqual(body)
    expect(calls[0]).toEqual({ url: "/api/server-status", init: { cache: "no-store" } })
    expect(SERVER_STATUS_POLL_MS).toBe(15_000)
    expect(qc.getQueryCache().find({ queryKey: SERVER_STATUS_KEY })?.options).toMatchObject({ refetchInterval: 15_000 })
    responder = () => json({ error: "env rusak" }, 500)
    const e = renderHook(() => useServerStatus(), { wrapper: wrapper().w })
    // retry: 1 di hook → tunggu dua percobaan.
    await waitFor(() => expect(e.result.current.isError).toBe(true), { timeout: 5000 })
    expect(e.result.current.error?.message).toBe("env rusak")
    responder = () => new Response("", { status: 503, statusText: "Service Unavailable" })
    const f = renderHook(() => useServerStatus(), { wrapper: wrapper().w })
    await waitFor(() => expect(f.result.current.isError).toBe(true), { timeout: 5000 })
    expect(f.result.current.error?.message).toBe("503 Service Unavailable")
  })
})

describe("use-os-images", () => {
  const img = (o: Partial<OsImageInfo>): OsImageInfo => ({ id: "ubuntu-24.04", name: "Ubuntu", version: "24.04", arch: "amd64", method: "autoinstall", bootable: true, available: true, reason: null, builtin: false, source: { kernel: "k", initrd: "i", repo: "r" }, repoUrl: "http://x/media/r", usedBy: 0, createdAt: "2026-01-01T00:00:00.000Z", ...o }) // M6 CR-5-9: tipe satu sumber, field M5 wajib
  it("GET /api/os-images; error pesan server / status", async () => {
    responder = () => json([img({})])
    const { qc, w } = wrapper()
    const r = renderHook(() => useOsImages(), { wrapper: w })
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true))
    expect(r.result.current.data).toEqual([img({})])
    expect(calls[0]).toEqual({ url: "/api/os-images", init: { cache: "no-store" } })
    expect(qc.getQueryData(OS_IMAGES_KEY)).toEqual([img({})])
    responder = () => json({ error: "db" }, 500)
    const e = renderHook(() => useOsImages(), { wrapper: wrapper().w })
    await waitFor(() => expect(e.result.current.isError).toBe(true))
    expect(e.result.current.error?.message).toBe("db")
    responder = () => new Response("", { status: 500, statusText: "Internal Server Error" })
    const f = renderHook(() => useOsImages(), { wrapper: wrapper().w })
    await waitFor(() => expect(f.result.current.isError).toBe(true))
    expect(f.result.current.error?.message).toBe("500 Internal Server Error")
  })
  it("installBlockReason: tersedia → null; tidak tersedia → alasan server/default; Windows; non-bootable", () => {
    expect(installBlockReason(undefined)).toBeNull()
    expect(installBlockReason(img({}))).toBeNull()
    expect(installBlockReason(img({ available: false, reason: "Media ubuntu-22.04 tidak tersedia" }))).toBe("Media ubuntu-22.04 tidak tersedia")
    expect(installBlockReason(img({ available: false, reason: null }))).toBe("Media tidak tersedia di server")
    expect(installBlockReason(img({ method: "unattend" }))).toMatch(/Windows: hanya generator unattend\.xml/)
    expect(installBlockReason(img({ bootable: false }))).toBe("Image tidak bisa di-boot lewat PXE")
  })
})

// Carry-over CR-2-11: subscriber berikutnya tidak menggeser `now` diam-diam; subscriber pertama
// (setelah semua unmount) menyegarkan jam.
describe("carry-over CR-2-11 use-now", () => {
  it("komponen kedua yang mount belakangan memakai jam yang sama dengan yang pertama", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.parse("2026-11-05T10:00:00Z"))
      const a = renderHook(() => useNow())
      const first = a.result.current
      vi.setSystemTime(Date.parse("2026-11-05T10:00:10Z")) // 10 dtk, belum tick 15 dtk
      const b = renderHook(() => useNow())
      expect(b.result.current).toBe(first)
      expect(a.result.current).toBe(first)
      act(() => {
        vi.advanceTimersByTime(15_000)
      })
      expect(a.result.current).toBe(b.result.current)
      expect(a.result.current).toBeGreaterThan(first)
      a.unmount()
      b.unmount()
      // Semua unmount → subscriber pertama berikutnya menyegarkan jam (CR-2-2).
      vi.setSystemTime(Date.parse("2026-11-05T11:00:00Z"))
      const c = renderHook(() => useNow())
      expect(c.result.current - Date.parse("2026-11-05T11:00:00Z")).toBe(a.result.current - Date.parse("2026-11-05T10:00:25Z"))
      c.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
