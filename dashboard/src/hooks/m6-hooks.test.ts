// M6-T8/T9 hook (jsdom): JobLogClient — CR-5-5 (404/4xx final tanpa polling lagi), sesi habis
// (401, SSE `end` reason session), 429 Retry-After, job terhapus (`end` status deleted);
// useJobs — CR-5-4 polling hanya halaman pertama; use-session (username, logout).
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isSessionHalted, rateLimitRemainingSec, resetApiState, setApiListener } from "@/lib/api-client"
import type { JobLogEvent, JobSummary, JobsResponse } from "@/lib/types"

import { JobLogClient, LOG_POLL_MS, SSE_MAX_FAILURES, SSE_RETRY_MS, type JobLogDeps, type LogConnection } from "./use-job-log"
import { JOBS_KEY, JOBS_POLL_MS, useJobs } from "./use-jobs"
import { logout, useSession } from "./use-session"

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers })

const ev = (seq: number): JobLogEvent => ({
  seq,
  at: "2026-11-06T10:00:00.000Z",
  kind: "system",
  level: "info",
  source: "boot-script",
  message: `m${seq}`,
  repeat: 1,
  lastAt: "2026-11-06T10:00:00.000Z",
})

class FakeES {
  static all: FakeES[] = []
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>()
  onerror: (() => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeES.all.push(this)
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.closed = true
  }
  emit(type: string, data?: unknown) {
    const e = { data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent
    for (const fn of this.listeners.get(type) ?? []) fn(e)
  }
  static last() {
    return FakeES.all[FakeES.all.length - 1]
  }
}

function recorder() {
  const conns: LogConnection[] = []
  let ended = 0
  return {
    conns,
    get ended() {
      return ended
    },
    h: {
      onEvents: () => {},
      onConnection: (c: LogConnection) => conns.push(c),
      onStage: () => {},
      onEnd: () => {
        ended++
      },
    },
  }
}

/** Gagalkan SSE sampai klien beralih ke polling JSON. */
function failSse() {
  for (let i = 0; i < SSE_MAX_FAILURES; i++) {
    FakeES.last().onerror?.()
    if (i < SSE_MAX_FAILURES - 1) vi.advanceTimersByTime(SSE_RETRY_MS)
  }
}

describe("JobLogClient (M6)", () => {
  beforeEach(() => {
    FakeES.all = []
    resetApiState()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetApiState()
  })

  const deps = (fetchFn: JobLogDeps["fetch"], onUnauthorized = vi.fn()): JobLogDeps => ({
    EventSource: FakeES as unknown as JobLogDeps["EventSource"],
    fetch: fetchFn,
    onUnauthorized,
  })

  it("CR-5-5: polling 404 → status final not-found, tidak ada request lagi", async () => {
    const fetchFn = vi.fn(async () => json({ error: "Job tidak ditemukan" }, 404))
    const r = recorder()
    new JobLogClient("job-x", r.h, deps(fetchFn)).start()
    failSse()
    await vi.waitFor(() => expect(r.conns.at(-1)).toBe("not-found"))
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS * 4)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(r.conns).not.toContain("polling")
    expect(r.ended).toBe(0)
  })

  it("CR-5-5: 4xx lain (400) juga final; 5xx tetap mencoba ulang", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "x" }, 503))
      .mockResolvedValueOnce(json({ error: "ID job tidak valid" }, 400))
    const r = recorder()
    new JobLogClient("job-1", r.h, { fetch: fetchFn }).start()
    await vi.waitFor(() => expect(r.conns.at(-1)).toBe("reconnecting"))
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS)
    await vi.waitFor(() => expect(r.conns.at(-1)).toBe("not-found"))
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS * 3)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("polling 401 → status session + onUnauthorized, berhenti", async () => {
    const fetchFn = vi.fn(async () => json({ error: "Perlu login" }, 401))
    const onUnauth = vi.fn()
    const r = recorder()
    new JobLogClient("job-1", r.h, { fetch: fetchFn, onUnauthorized: onUnauth }).start()
    await vi.waitFor(() => expect(r.conns.at(-1)).toBe("session"))
    expect(onUnauth).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS * 3)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("SSE end {reason:session} → session, stream ditutup, tanpa reconnect; bawaan memicu alur sesi habis global", () => {
    const onUnauthorized = vi.fn()
    const off = setApiListener({ onUnauthorized, onRateLimited: vi.fn() })
    const r = recorder()
    // Tanpa onUnauthorized injeksi → notifySessionExpired global.
    new JobLogClient("job-1", r.h, { EventSource: FakeES as unknown as JobLogDeps["EventSource"], fetch: vi.fn() }).start()
    const es = FakeES.last()
    es.emit("open")
    es.emit("end", { reason: "session" })
    expect(r.conns.at(-1)).toBe("session")
    expect(es.closed).toBe(true)
    expect(r.ended).toBe(0)
    expect(isSessionHalted()).toBe(true)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(SSE_RETRY_MS * 3)
    expect(FakeES.all).toHaveLength(1)
    off()
  })

  it("sesi sudah habis (global) → klien log baru tidak membuka SSE", () => {
    const off = setApiListener({ onUnauthorized: vi.fn(), onRateLimited: vi.fn() })
    const r = recorder()
    new JobLogClient("job-1", recorder().h, { EventSource: FakeES as unknown as JobLogDeps["EventSource"], fetch: vi.fn() }).start()
    FakeES.last().emit("end", { reason: "session" })
    const before = FakeES.all.length
    new JobLogClient("job-2", r.h, { EventSource: FakeES as unknown as JobLogDeps["EventSource"], fetch: vi.fn() }).start()
    expect(FakeES.all).toHaveLength(before)
    expect(r.conns).toEqual(["connecting", "session"])
    off()
  })

  it("SSE end {status:deleted} → not-found; end lain / data rusak → ended", () => {
    const a = recorder()
    new JobLogClient("job-1", a.h, deps(vi.fn())).start()
    FakeES.last().emit("end", { status: "deleted" })
    expect(a.conns.at(-1)).toBe("not-found")
    expect(a.ended).toBe(0)
    const b = recorder()
    new JobLogClient("job-2", b.h, deps(vi.fn())).start()
    FakeES.last().emit("end", "{rusak")
    expect(b.conns.at(-1)).toBe("ended")
    expect(b.ended).toBe(1)
  })

  it("polling 429 → menunggu Retry-After (bukan 5 dtk) lalu lanjut; jeda dicatat global", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "Terlalu banyak request" }, 429, { "Retry-After": "12" }))
      .mockResolvedValueOnce(json({ events: [ev(1)], lastSeq: 1, final: true }))
    const r = recorder()
    new JobLogClient("job-1", r.h, { fetch: fetchFn }).start()
    await vi.waitFor(() => expect(r.conns.at(-1)).toBe("reconnecting"))
    expect(rateLimitRemainingSec()).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS + 1000)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(12_000 - LOG_POLL_MS - 1000)
    await vi.waitFor(() => expect(r.ended).toBe(1))
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

// ---- useJobs: CR-5-4 ----

function job(n: number): JobSummary {
  const at = new Date(Date.UTC(2026, 10, 6, 10, 0, n)).toISOString()
  return {
    id: `job-${String(n).padStart(3, "0")}`,
    hostId: "525400990011",
    host: null,
    type: "install",
    osImageId: "ubuntu-24.04",
    status: "done",
    stages: [],
    failureReason: null,
    installerBoots: 1,
    createdAt: at,
    updatedAt: at,
    finishedAt: at,
    eventCount: 0,
  }
}
const page = (from: number, count: number, nextBefore: string | null): JobsResponse => ({
  jobs: Array.from({ length: count }, (_, i) => job(from - i)),
  nextBefore,
  serverTime: "2026-11-06T10:01:00.000Z",
})

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const w = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
  return { qc, w }
}

describe("useJobs (CR-5-4 klien)", () => {
  let calls: string[]
  let head: JobsResponse
  beforeEach(() => {
    resetApiState()
    calls = []
    head = page(10, 5, "c-6")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url)
        return json(url.includes("before=c-6") ? page(5, 5, null) : head)
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("polling hanya meminta halaman pertama dan menggabungkan job baru tanpa gap", async () => {
    const { qc, w } = wrapper()
    const r = renderHook(() => useJobs({ hostId: null, status: null }), { wrapper: w })
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true))
    await act(() => r.result.current.fetchNextPage())
    await waitFor(() => expect(r.result.current.data?.pages).toHaveLength(2))
    expect(calls).toEqual(["/api/jobs?limit=50", "/api/jobs?limit=50&before=c-6"])

    // Dua job baru masuk; siklus polling berikutnya (jam maju > setengah interval).
    head = page(12, 5, "c-8")
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now + JOBS_POLL_MS)
    await act(() => qc.refetchQueries({ queryKey: [...JOBS_KEY, "head"] }))
    await waitFor(() => expect(r.result.current.data?.pages[0].jobs[0].id).toBe("job-012"))
    // Tidak ada refetch halaman lama dengan cursor lama.
    expect(calls.slice(2)).toEqual(["/api/jobs?limit=50"])
    const ids = r.result.current.data!.pages.flatMap((p) => p.jobs.map((j) => j.id))
    expect(ids).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => job(n).id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(r.result.current.hasNextPage).toBe(false)
  })

  it("head tidak menggandakan request saat daftar baru saja dimuat", async () => {
    const { qc, w } = wrapper()
    const r = renderHook(() => useJobs({ hostId: null, status: null }), { wrapper: w })
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true))
    await act(() => qc.refetchQueries({ queryKey: [...JOBS_KEY, "head"] }))
    expect(calls).toEqual(["/api/jobs?limit=50"])
  })

  it("error polling head tampil sebagai error daftar (pesan server)", async () => {
    const { qc, w } = wrapper()
    const r = renderHook(() => useJobs({ hostId: null, status: null }), { wrapper: w })
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true))
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Gangguan DB" }, 500)))
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + JOBS_POLL_MS)
    await act(() => qc.refetchQueries({ queryKey: [...JOBS_KEY, "head"] }))
    await waitFor(() => expect(r.result.current.isError).toBe(true))
    expect(r.result.current.error?.message).toBe("Gangguan DB")
    // Data lama tetap ada.
    expect(r.result.current.data?.pages[0].jobs).toHaveLength(5)
  })
})

// ---- use-session ----

describe("use-session", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetApiState()
  })

  it("useSession: username dari GET /api/auth/session", async () => {
    const f = vi.fn(async () => json({ username: "admin", expiresAt: "2026-11-06T22:00:00.000Z" }))
    vi.stubGlobal("fetch", f)
    const r = renderHook(() => useSession(), { wrapper: wrapper().w })
    await waitFor(() => expect(r.result.current.data?.username).toBe("admin"))
    expect(f).toHaveBeenCalledWith("/api/auth/session", { cache: "no-store" })
  })

  it("logout: 204/401 → ok; 403 → pesan server; jaringan gagal → pesan tetap", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await logout(f)).toEqual({ ok: true })
    expect(f).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", cache: "no-store" })
    f.mockResolvedValueOnce(json({ error: "Perlu login" }, 401))
    expect(await logout(f)).toEqual({ ok: true })
    f.mockResolvedValueOnce(json({ error: "Request lintas-origin ditolak" }, 403))
    expect(await logout(f)).toEqual({ ok: false, message: "Request lintas-origin ditolak" })
    f.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    expect(await logout(f)).toEqual({ ok: false, message: "Tidak bisa menghubungi server" })
    // logout tidak lewat apiFetch → 401 di sini tidak menahan klien.
    expect(isSessionHalted()).toBe(false)
  })
})
