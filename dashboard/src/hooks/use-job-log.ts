"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { HOSTS_KEY } from "@/hooks/use-hosts"
import { JOBS_KEY, jobKey } from "@/hooks/use-jobs"
import {
  ApiError,
  apiFetch,
  isSessionHalted,
  noteRateLimited,
  notifySessionExpired,
  parseRetryAfter,
} from "@/lib/api-client"
import { mergeLogEvents, parseLogEvent } from "@/lib/jobs"
import type { JobLogEvent, JobLogResponse, JobSummary } from "@/lib/types"

/**
 * Status koneksi log:
 *  - `connecting` — membuka stream pertama kali;
 *  - `live` — SSE tersambung;
 *  - `reconnecting` — koneksi putus, mencoba ulang;
 *  - `polling` — fallback JSON tiap 5 dtk (SSE gagal 3× berturut-turut);
 *  - `ended` — job final dan semua event sudah diterima;
 *  - `not-found` — job tidak ada / terhapus (404 atau 4xx lain selain 401/429, atau SSE `end`
 *    `{"status":"deleted"}`) — final, tanpa polling lagi (CR-5-5);
 *  - `session` — sesi habis (401 atau SSE `end` `{"reason":"session"}`) — final; alur sesi habis
 *    global (redirect ke login) dipicu.
 */
export type LogConnection =
  | "connecting"
  | "live"
  | "reconnecting"
  | "polling"
  | "ended"
  | "not-found"
  | "session"

/** Jeda sebelum membuka ulang SSE (sama dengan `retry:` server). */
export const SSE_RETRY_MS = 3_000
/** Jumlah kegagalan SSE berturut-turut sebelum beralih ke polling JSON. */
export const SSE_MAX_FAILURES = 3
export const LOG_POLL_MS = 5_000
/** Batas event per respons JSON server (`LOG_PAGE`). */
const JSON_PAGE = 1000

type Handlers = {
  onEvents: (events: JobLogEvent[]) => void
  onConnection: (c: LogConnection) => void
  onStage: (job: JobSummary) => void
  onEnd: () => void
}

type EventSourceCtor = new (url: string) => EventSource

export type JobLogDeps = {
  EventSource?: EventSourceCtor
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  /** Sesi habis (bawaan: `notifySessionExpired` → redirect login global). */
  onUnauthorized?: () => void
}

function defaultDeps(): JobLogDeps {
  return {
    EventSource:
      typeof EventSource === "undefined" ? undefined : EventSource,
    // M6: lewat wrapper API (401 → sesi habis, 429 → jeda bersama).
    fetch: apiFetch,
  }
}

/**
 * Klien log satu job: SSE (`GET /api/jobs/:id/logs`) dengan resume `?after=<seq terakhir>`,
 * dibuka ulang sendiri setelah `SSE_RETRY_MS` bila putus; setelah `SSE_MAX_FAILURES` kegagalan
 * berturut-turut (tanpa `open` di antaranya) beralih ke polling JSON `?format=json&after=`.
 * Tidak bergantung React (diuji dengan EventSource/fetch palsu).
 */
export class JobLogClient {
  private es: EventSource | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastSeq = 0
  private failures = 0
  private stopped = false
  private readonly deps: JobLogDeps

  constructor(
    private readonly jobId: string,
    private readonly h: Handlers,
    deps?: JobLogDeps,
  ) {
    this.deps = deps ?? defaultDeps()
  }

  private get base() {
    return `/api/jobs/${encodeURIComponent(this.jobId)}/logs`
  }

  start() {
    this.h.onConnection("connecting")
    if (this.deps.EventSource) this.openSse()
    else this.poll()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.es?.close()
    this.es = null
  }

  private receive(events: JobLogEvent[]) {
    if (!events.length) return
    for (const e of events) if (e.seq > this.lastSeq) this.lastSeq = e.seq
    this.h.onEvents(events)
  }

  private finish() {
    this.stop()
    this.h.onConnection("ended")
    this.h.onEnd()
  }

  /** Status final selain `ended` (tanpa invalidasi daftar). */
  private halt(c: "not-found" | "session") {
    this.stop()
    this.h.onConnection(c)
    if (c === "session") (this.deps.onUnauthorized ?? notifySessionExpired)()
  }

  /** `event: end` server: `{reason:"session"}` → sesi habis; `{status:"deleted"}` → job hilang. */
  private onEndEvent(data: string | undefined) {
    let d: { reason?: unknown; status?: unknown } = {}
    try {
      d = JSON.parse(data ?? "{}") ?? {}
    } catch {
      // data rusak → anggap selesai biasa
    }
    if (d.reason === "session") this.halt("session")
    else if (d.status === "deleted") this.halt("not-found")
    else this.finish()
  }

  private openSse() {
    if (this.stopped) return
    // Sesi sudah dinyatakan habis oleh request lain → jangan buka koneksi baru.
    if (!this.deps.onUnauthorized && isSessionHalted()) return this.halt("session")
    const ES = this.deps.EventSource!
    const es = new ES(this.lastSeq ? `${this.base}?after=${this.lastSeq}` : this.base)
    this.es = es
    es.addEventListener("open", () => {
      this.failures = 0
      this.h.onConnection("live")
    })
    es.addEventListener("log", (ev) => {
      const e = parseLogEvent((ev as MessageEvent<string>).data)
      if (e) this.receive([e])
    })
    es.addEventListener("stage", (ev) => {
      try {
        this.h.onStage(JSON.parse((ev as MessageEvent<string>).data) as JobSummary)
      } catch {
        // data rusak: abaikan, polling detail job tetap memperbarui status
      }
    })
    es.addEventListener("end", (ev) => this.onEndEvent((ev as MessageEvent<string>).data))
    es.onerror = () => {
      if (this.stopped || this.es !== es) return
      // Tutup sendiri dan buka ulang dengan `?after=` agar resume eksplisit (tanpa baris ganda).
      es.close()
      this.es = null
      this.failures++
      if (this.failures >= SSE_MAX_FAILURES) {
        this.poll()
        return
      }
      this.h.onConnection("reconnecting")
      this.timer = setTimeout(() => this.openSse(), SSE_RETRY_MS)
    }
  }

  private async poll() {
    if (this.stopped) return
    // `after = lastSeq − 1`: event terakhir ikut terkirim ulang sehingga `repeat` gabungan ikut
    // diperbarui (diganti per seq, bukan ditambah).
    const after = Math.max(0, this.lastSeq - 1)
    try {
      const res = await this.deps.fetch(`${this.base}?format=json&after=${after}`, {
        cache: "no-store",
      })
      if (this.stopped) return
      if (res.status === 401) return this.halt("session")
      if (res.status === 429) {
        const sec = parseRetryAfter(res.headers.get("retry-after"))
        // Fetch injeksi (test) tidak lewat apiFetch → catat jeda di sini juga (idempoten).
        if (this.deps.fetch !== apiFetch) noteRateLimited(sec)
        this.h.onConnection("reconnecting")
        this.timer = setTimeout(() => this.poll(), sec * 1000)
        return
      }
      // CR-5-5: 404 (atau 4xx lain) final — job tidak ada / terhapus; jangan polling tanpa batas.
      if (res.status >= 400 && res.status < 500) return this.halt("not-found")
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as JobLogResponse
      if (this.stopped) return
      this.receive(body.events)
      if (body.final) {
        this.finish()
        return
      }
      this.h.onConnection("polling")
      const more = body.events.length >= JSON_PAGE
      this.timer = setTimeout(() => this.poll(), more ? 0 : LOG_POLL_MS)
    } catch (e) {
      if (this.stopped) return
      // Request ditahan lokal oleh apiFetch: sesi habis → final; jeda rate limit → tunggu sisa jeda.
      if (e instanceof ApiError && e.status === 401) return this.halt("session")
      const wait =
        e instanceof ApiError && e.status === 429 && e.retryAfterSec
          ? e.retryAfterSec * 1000
          : LOG_POLL_MS
      this.h.onConnection("reconnecting")
      this.timer = setTimeout(() => this.poll(), wait)
    }
  }
}

/** Jeda penggabungan render untuk backlog besar (banyak event SSE beruntun). */
const FLUSH_MS = 30

type LogState = {
  jobId: string | null
  events: JobLogEvent[]
  connection: LogConnection
}

const EMPTY: JobLogEvent[] = []

/**
 * Log job live (DEC-014 §5): event `log` digabung per `seq`; event `stage` memperbarui cache
 * detail job dan menginvalidasi daftar job + host; `end` → status `ended`. `deps` hanya untuk
 * test dan harus stabil (referensi sama antar-render).
 */
export function useJobLog(
  jobId: string | null,
  deps?: JobLogDeps,
): { events: JobLogEvent[]; connection: LogConnection } {
  const qc = useQueryClient()
  const [state, setState] = React.useState<LogState>({
    jobId: null,
    events: EMPTY,
    connection: "connecting",
  })

  React.useEffect(() => {
    if (!jobId) return
    let pending: JobLogEvent[] = []
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const update = (fn: (s: LogState) => Partial<LogState>) =>
      setState((s) => {
        const cur =
          s.jobId === jobId
            ? s
            : { jobId, events: EMPTY, connection: "connecting" as const }
        return { ...cur, ...fn(cur) }
      })
    const flush = () => {
      flushTimer = undefined
      const batch = pending
      pending = []
      update((s) => ({ events: mergeLogEvents(s.events, batch) }))
    }
    const client = new JobLogClient(
      jobId,
      {
        onEvents: (evs) => {
          pending.push(...evs)
          flushTimer ??= setTimeout(flush, FLUSH_MS)
        },
        onConnection: (c) => update(() => ({ connection: c })),
        onStage: (job) => {
          qc.setQueryData(jobKey(job.id), job)
          qc.invalidateQueries({ queryKey: [...JOBS_KEY, "list"] })
          qc.invalidateQueries({ queryKey: HOSTS_KEY })
        },
        onEnd: () => {
          qc.invalidateQueries({ queryKey: JOBS_KEY })
          qc.invalidateQueries({ queryKey: HOSTS_KEY })
        },
      },
      deps,
    )
    client.start()
    return () => {
      client.stop()
      clearTimeout(flushTimer)
    }
  }, [jobId, qc, deps])

  return state.jobId === jobId && jobId
    ? { events: state.events, connection: state.connection }
    : { events: EMPTY, connection: "connecting" }
}
