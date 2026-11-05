// M5-T8 hook (jsdom): use-jobs (daftar + cursor + detail) dan use-job-log (SSE, resume,
// reconnect, fallback polling JSON, event stage/end). EventSource & fetch palsu.
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HOSTS_KEY } from "./use-hosts"
import {
  JobLogClient,
  LOG_POLL_MS,
  SSE_MAX_FAILURES,
  SSE_RETRY_MS,
  useJobLog,
  type JobLogDeps,
  type LogConnection,
} from "./use-job-log"
import { JobsApiError, jobKey, jobsUrl, useJob, useJobs } from "./use-jobs"
import type { JobLogEvent, JobSummary } from "@/lib/types"

const json = (body: unknown, status = 200) => Response.json(body, { status })

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const w = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  return { qc, w }
}

function job(id: string, p: Partial<JobSummary> = {}): JobSummary {
  return {
    id,
    hostId: "525400990011",
    host: { mac: "52:54:00:99:00:11", hostname: null },
    type: "install",
    osImageId: "ubuntu-24.04",
    status: "booting",
    stages: [],
    failureReason: null,
    installerBoots: 0,
    createdAt: "2026-11-05T10:00:00.000Z",
    updatedAt: "2026-11-05T10:00:00.000Z",
    finishedAt: null,
    eventCount: 0,
    ...p,
  }
}

const ev = (seq: number, p: Partial<JobLogEvent> = {}): JobLogEvent => ({
  seq,
  at: "2026-11-05T10:00:00.000Z",
  kind: "system",
  level: "info",
  source: "boot-script",
  message: `m${seq}`,
  repeat: 1,
  ...p,
})

describe("use-jobs", () => {
  let calls: string[] = []
  let responder: (url: string) => Response
  beforeEach(() => {
    calls = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url)
        return responder(url)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it("jobsUrl: filter + limit + before", () => {
    expect(jobsUrl({})).toBe("/api/jobs?limit=50")
    expect(jobsUrl({ hostId: "525400990011", status: "failed", before: "job-9", limit: 10 })).toBe(
      "/api/jobs?hostId=525400990011&status=failed&limit=10&before=job-9",
    )
  })

  it("useJobs: halaman pertama + fetchNextPage dengan cursor nextBefore", async () => {
    responder = (url) =>
      url.includes("before=job-2")
        ? json({ jobs: [job("job-3")], nextBefore: null, serverTime: "2026-11-05T10:00:00.000Z" })
        : json({ jobs: [job("job-1"), job("job-2")], nextBefore: "job-2", serverTime: "2026-11-05T10:00:00.000Z" })
    const { w } = wrapper()
    const r = renderHook(() => useJobs({ hostId: "525400990011", status: null }), { wrapper: w })
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true))
    expect(calls[0]).toBe("/api/jobs?hostId=525400990011&limit=50")
    expect(r.result.current.hasNextPage).toBe(true)
    await act(() => r.result.current.fetchNextPage())
    await waitFor(() => expect(r.result.current.data?.pages).toHaveLength(2))
    expect(r.result.current.data!.pages.flatMap((p) => p.jobs.map((j) => j.id))).toEqual(["job-1", "job-2", "job-3"])
    expect(r.result.current.hasNextPage).toBe(false)
  })

  it("useJobs: error membawa pesan server", async () => {
    responder = () => json({ error: "Query tidak valid: status" }, 400)
    const r = renderHook(() => useJobs({}), { wrapper: wrapper().w })
    await waitFor(() => expect(r.result.current.isError).toBe(true))
    expect(r.result.current.error?.message).toBe("Query tidak valid: status")
  })

  it("useJob: detail; 404 → JobsApiError tanpa retry; id null → tidak fetch", async () => {
    responder = (url) => (url.endsWith("/job-1") ? json(job("job-1")) : json({ error: "Job tidak ditemukan" }, 404))
    const { w } = wrapper()
    const a = renderHook(() => useJob("job-1"), { wrapper: w })
    await waitFor(() => expect(a.result.current.data?.id).toBe("job-1"))
    const b = renderHook(() => useJob("job-x"), { wrapper: w })
    await waitFor(() => expect(b.result.current.isError).toBe(true))
    expect(b.result.current.error).toBeInstanceOf(JobsApiError)
    expect((b.result.current.error as JobsApiError).status).toBe(404)
    expect(calls.filter((c) => c.endsWith("/job-x"))).toHaveLength(1)
    renderHook(() => useJob(null), { wrapper: w })
    expect(calls.every((c) => !c.endsWith("/api/jobs/"))).toBe(true)
  })

  it("useJob: error tanpa body JSON → status teks (5xx di-retry)", async () => {
    responder = () => new Response("x", { status: 502, statusText: "Bad Gateway" })
    const r = renderHook(() => useJob("job-1"), { wrapper: wrapper().w })
    await waitFor(() => expect(r.result.current.isError).toBe(true), { timeout: 5000 })
    expect(r.result.current.error?.message).toBe("502 Bad Gateway")
  })
})

// ---- EventSource palsu ----
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
    const ev = { data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent
    for (const fn of this.listeners.get(type) ?? []) fn(ev)
  }
  fail() {
    this.onerror?.()
  }
  static last() {
    return FakeES.all[FakeES.all.length - 1]
  }
}

function recorder() {
  const events: JobLogEvent[][] = []
  const conns: LogConnection[] = []
  const stages: JobSummary[] = []
  let ended = 0
  return {
    events,
    conns,
    stages,
    get ended() {
      return ended
    },
    h: {
      onEvents: (e: JobLogEvent[]) => events.push(e),
      onConnection: (c: LogConnection) => conns.push(c),
      onStage: (j: JobSummary) => stages.push(j),
      onEnd: () => {
        ended++
      },
    },
  }
}

describe("JobLogClient", () => {
  beforeEach(() => {
    FakeES.all = []
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  const deps = (fetchFn: typeof fetch = vi.fn()): JobLogDeps => ({
    EventSource: FakeES as unknown as JobLogDeps["EventSource"],
    fetch: fetchFn,
  })

  it("SSE: open → live, log diteruskan, stage, end → ended + tutup", () => {
    const r = recorder()
    const c = new JobLogClient("job-1", r.h, deps())
    c.start()
    const es = FakeES.last()
    expect(es.url).toBe("/api/jobs/job-1/logs")
    es.emit("open")
    es.emit("log", ev(1))
    es.emit("log", "{rusak")
    es.emit("stage", job("job-1", { status: "installing" }))
    es.emit("stage", "{rusak")
    es.emit("end", { status: "done" })
    expect(r.conns).toEqual(["connecting", "live", "ended"])
    expect(r.events).toEqual([[ev(1)]])
    expect(r.stages.map((s) => s.status)).toEqual(["installing"])
    expect(r.ended).toBe(1)
    expect(es.closed).toBe(true)
  })

  it("putus → reconnecting, buka ulang setelah retry dengan ?after=<seq terakhir>", () => {
    const r = recorder()
    const c = new JobLogClient("job-1", r.h, deps())
    c.start()
    const a = FakeES.last()
    a.emit("open")
    a.emit("log", ev(1))
    a.emit("log", ev(7))
    a.fail()
    expect(a.closed).toBe(true)
    expect(r.conns.at(-1)).toBe("reconnecting")
    vi.advanceTimersByTime(SSE_RETRY_MS)
    const b = FakeES.last()
    expect(b).not.toBe(a)
    expect(b.url).toBe("/api/jobs/job-1/logs?after=7")
    b.emit("open")
    expect(r.conns.at(-1)).toBe("live")
    // error dari stream lama yang sudah diganti diabaikan
    a.fail()
    expect(FakeES.all).toHaveLength(2)
    c.stop()
    expect(b.closed).toBe(true)
  })

  it(`${SSE_MAX_FAILURES} kegagalan berturut-turut → polling JSON (after = lastSeq−1), final → ended`, async () => {
    const responses = [
      json({ events: [ev(1), ev(2)], lastSeq: 2, final: false }),
      json({ error: "x" }, 500),
      json({ events: [ev(2, { repeat: 3 }), ev(3)], lastSeq: 3, final: true }),
    ]
    const fetchFn = vi.fn(async () => responses.shift()!)
    const r = recorder()
    const c = new JobLogClient("job-1", r.h, deps(fetchFn as unknown as typeof fetch))
    c.start()
    for (let i = 0; i < SSE_MAX_FAILURES; i++) {
      FakeES.last().fail()
      if (i < SSE_MAX_FAILURES - 1) vi.advanceTimersByTime(SSE_RETRY_MS)
    }
    expect(FakeES.all).toHaveLength(SSE_MAX_FAILURES)
    await vi.waitFor(() => expect(r.conns.at(-1)).toBe("polling"))
    expect(fetchFn).toHaveBeenNthCalledWith(1, "/api/jobs/job-1/logs?format=json&after=0", { cache: "no-store" })
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS)
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))
    expect(r.conns.at(-1)).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS)
    await vi.waitFor(() => expect(r.ended).toBe(1))
    expect(fetchFn).toHaveBeenNthCalledWith(3, "/api/jobs/job-1/logs?format=json&after=1", { cache: "no-store" })
    expect(r.events.flat().map((e) => [e.seq, e.repeat])).toEqual([[1, 1], [2, 1], [2, 3], [3, 1]])
    expect(r.conns.at(-1)).toBe("ended")
  })

  it("polling: halaman penuh (1000) → langsung minta lagi; stop menghentikan", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ev(i + 1))
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ events: page, lastSeq: 1000, final: false }))
      .mockResolvedValue(json({ events: [], lastSeq: 1000, final: false }))
    const r = recorder()
    const c = new JobLogClient("job-1", r.h, { fetch: fetchFn as unknown as typeof fetch })
    c.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))
    expect(fetchFn.mock.calls[1][0]).toBe("/api/jobs/job-1/logs?format=json&after=999")
    c.stop()
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS * 3)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("stop di tengah fetch: hasil diabaikan", async () => {
    let resolve!: (r: Response) => void
    const fetchFn = vi.fn(() => new Promise<Response>((res) => (resolve = res)))
    const r = recorder()
    const c = new JobLogClient("job-1", r.h, { fetch: fetchFn as unknown as typeof fetch })
    c.start()
    c.stop()
    resolve(json({ events: [ev(1)], lastSeq: 1, final: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(r.events).toEqual([])
    expect(r.ended).toBe(0)
  })
})

describe("useJobLog", () => {
  beforeEach(() => {
    FakeES.all = []
  })
  const deps: JobLogDeps = {
    EventSource: FakeES as unknown as JobLogDeps["EventSource"],
    fetch: vi.fn() as unknown as typeof fetch,
  }

  it("menggabung event per seq (tanpa baris ganda), stage → cache job + invalidasi, end → ended", async () => {
    const { qc, w } = wrapper()
    const inval = vi.spyOn(qc, "invalidateQueries")
    const r = renderHook(({ id }) => useJobLog(id, deps), { wrapper: w, initialProps: { id: "job-1" as string | null } })
    expect(r.result.current.connection).toBe("connecting")
    const es = FakeES.last()
    act(() => {
      es.emit("open")
      es.emit("log", ev(1))
      es.emit("log", ev(2))
      es.emit("log", ev(2, { repeat: 5 }))
    })
    await waitFor(() => expect(r.result.current.events.map((e) => [e.seq, e.repeat])).toEqual([[1, 1], [2, 5]]))
    expect(r.result.current.connection).toBe("live")
    act(() => es.emit("stage", job("job-1", { status: "configuring" })))
    expect(qc.getQueryData<JobSummary>(jobKey("job-1"))?.status).toBe("configuring")
    expect(inval).toHaveBeenCalledWith({ queryKey: HOSTS_KEY })
    act(() => es.emit("end", { status: "done" }))
    expect(r.result.current.connection).toBe("ended")

    // Ganti job: state lama tidak bocor; stream lama ditutup.
    r.rerender({ id: "job-2" })
    expect(r.result.current.events).toEqual([])
    expect(FakeES.last().url).toBe("/api/jobs/job-2/logs")
    r.rerender({ id: null })
    expect(r.result.current).toEqual({ events: [], connection: "connecting" })
    expect(FakeES.last().closed).toBe(true)
  })
})
