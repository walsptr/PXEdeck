"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { HOSTS_KEY } from "@/hooks/use-hosts"
import { JOBS_KEY, jobKey } from "@/hooks/use-jobs"
import { mergeLogEvents, parseLogEvent } from "@/lib/jobs"
import type { JobLogEvent, JobLogResponse, JobSummary } from "@/lib/types"

/**
 * Status koneksi log:
 *  - `connecting` — membuka stream pertama kali;
 *  - `live` — SSE tersambung;
 *  - `reconnecting` — koneksi putus, mencoba ulang;
 *  - `polling` — fallback JSON tiap 5 dtk (SSE gagal 3× berturut-turut);
 *  - `ended` — job final dan semua event sudah diterima.
 */
export type LogConnection =
  | "connecting"
  | "live"
  | "reconnecting"
  | "polling"
  | "ended"

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
  fetch: typeof fetch
}

function defaultDeps(): JobLogDeps {
  return {
    EventSource:
      typeof EventSource === "undefined" ? undefined : EventSource,
    fetch: (...a) => fetch(...a),
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

  private openSse() {
    if (this.stopped) return
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
    es.addEventListener("end", () => this.finish())
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
    } catch {
      if (this.stopped) return
      this.h.onConnection("reconnecting")
      this.timer = setTimeout(() => this.poll(), LOG_POLL_MS)
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
