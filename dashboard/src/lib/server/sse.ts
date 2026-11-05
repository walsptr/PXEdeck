// SSE log job (M5-T6, plan §2.6, DEC-014 §5): `GET /api/jobs/:id/logs` dengan
// `Accept: text/event-stream`. Tail DB tiap `tickMs` (default 1 dtk):
//  - `retry: 3000` di awal; backlog lalu event baru → `event: log`, `id: <seq>`, data JSON event.
//  - Event gabungan (repeat berubah) dikirim ulang dengan `id` yang sama.
//  - Perubahan status job → `event: stage` (data `JobSummary`).
//  - Job final dan semua event tersalurkan → `event: end` lalu stream ditutup.
//  - Heartbeat `: ping` tiap 15 dtk; umur maksimum 30 mnt; maks 50 koneksi serentak per proses.
//  - Abort klien (`signal`) / cancel → semua timer dibersihkan.
// Semua timer memakai setTimeout/setInterval global (fake timers di test).
import { getEvent, eventsAfter, type JobEvent } from "@/lib/server/db/repos/job-events"
import { getJob } from "@/lib/server/db/repos/jobs"
import { sweepJobs } from "@/lib/server/job-lifecycle"
import { isFinal, toJobSummary } from "@/lib/server/jobs-service"

export const SSE_MAX_CONNECTIONS = 50
export const SSE_TICK_MS = 1000
export const SSE_HEARTBEAT_MS = 15_000
export const SSE_MAX_AGE_MS = 30 * 60_000
export const SSE_RETRY_MS = 3000

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform: kompresi Next/nginx tidak menahan stream.
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const

const KEY = Symbol.for("pxe.sseConnections")
const g = globalThis as typeof globalThis & { [KEY]?: { n: number } }
const counter = () => (g[KEY] ??= { n: 0 })

/** Jumlah stream SSE log yang sedang terbuka (proses ini). */
export function sseConnections(): number {
  return counter().n
}

export type SseOptions = { tickMs?: number; heartbeatMs?: number; maxAgeMs?: number }

function logFrame(e: JobEvent): string {
  const data = { seq: e.seq, at: e.at, kind: e.kind, level: e.level, source: e.source, message: e.message, repeat: e.repeat }
  return `event: log\nid: ${e.seq}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Stream SSE log job `jobId` mulai setelah `after`. null bila batas koneksi tercapai (→ 503).
 * Pemanggil memastikan job ada sebelum memanggil.
 */
export function jobLogStream(
  jobId: string,
  after: number,
  signal: AbortSignal | null,
  opts: SseOptions = {},
): ReadableStream<Uint8Array> | null {
  const c = counter()
  if (c.n >= SSE_MAX_CONNECTIONS) return null
  c.n++
  const tickMs = opts.tickMs ?? SSE_TICK_MS
  const heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_MS
  const maxAgeMs = opts.maxAgeMs ?? SSE_MAX_AGE_MS
  const enc = new TextEncoder()
  let closed = false
  let tickTimer: ReturnType<typeof setTimeout> | undefined
  let hbTimer: ReturnType<typeof setInterval> | undefined
  let ageTimer: ReturnType<typeof setTimeout> | undefined
  let ctrl: ReadableStreamDefaultController<Uint8Array>
  let onAbort: (() => void) | undefined

  const close = () => {
    if (closed) return
    closed = true
    clearTimeout(tickTimer)
    clearInterval(hbTimer)
    clearTimeout(ageTimer)
    if (onAbort) signal?.removeEventListener("abort", onAbort)
    c.n = Math.max(0, c.n - 1)
    try {
      ctrl.close()
    } catch {
      // stream sudah dibatalkan klien
    }
  }
  const send = (s: string) => {
    if (closed) return
    try {
      ctrl.enqueue(enc.encode(s))
    } catch {
      close()
    }
  }

  let lastSeq = after
  let lastRepeat = after > 0 ? (getEvent(jobId, after)?.repeat ?? 0) : 0
  let lastStatus: string | null = null

  const tick = () => {
    if (closed) return
    try {
      let job = getJob(jobId)
      if (!job) {
        send(`event: end\ndata: ${JSON.stringify({ status: "deleted" })}\n\n`)
        close()
        return
      }
      if (!isFinal(job.status) && sweepJobs(new Date(), job.hostId).length) job = getJob(jobId)!
      if (lastSeq > 0) {
        const cur = getEvent(jobId, lastSeq)
        if (cur && cur.repeat !== lastRepeat) {
          send(logFrame(cur))
          lastRepeat = cur.repeat
        }
      }
      for (;;) {
        const batch = eventsAfter(jobId, lastSeq, 500)
        for (const e of batch) {
          send(logFrame(e))
          lastSeq = e.seq
          lastRepeat = e.repeat
        }
        if (batch.length < 500) break
      }
      if (lastStatus !== null && job.status !== lastStatus) {
        send(`event: stage\ndata: ${JSON.stringify(toJobSummary(job))}\n\n`)
      }
      lastStatus = job.status
      if (isFinal(job.status) && lastSeq >= job.eventSeq) {
        send(`event: end\ndata: ${JSON.stringify({ status: job.status })}\n\n`)
        close()
        return
      }
    } catch {
      close()
      return
    }
    tickTimer = setTimeout(tick, tickMs)
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller
      if (signal) {
        if (signal.aborted) {
          close()
          return
        }
        onAbort = () => close()
        signal.addEventListener("abort", onAbort)
      }
      send(`retry: ${SSE_RETRY_MS}\n\n`)
      hbTimer = setInterval(() => send(": ping\n\n"), heartbeatMs)
      ageTimer = setTimeout(close, maxAgeMs)
      tick()
    },
    cancel() {
      close()
    },
  })
}
