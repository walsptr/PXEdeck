// SSE log job (M5-T6, plan §2.6, DEC-014 §5): `GET /api/jobs/:id/logs` dengan
// `Accept: text/event-stream`. Tail DB tiap `tickMs` (default 1 dtk):
//  - `retry: 3000` di awal; backlog lalu event baru → `event: log`, `id: <seq>`, data JSON event.
//  - Event gabungan (repeat berubah) dikirim ulang dengan `id` yang sama.
//  - Perubahan status job → `event: stage` (data `JobSummary`).
//  - Job final dan semua event tersalurkan → `event: end` lalu stream ditutup.
//  - Heartbeat `: ping` tiap 15 dtk; umur maksimum 30 mnt; maks 50 koneksi serentak per proses.
//  - Abort klien (`signal`) / cancel → semua timer dibersihkan.
//  - M6 (DEC-017 §4/§5, SR-5-7): maks `SSE_MAX_PER_SESSION` stream per sesi (→ 429); sesi divalidasi
//    ulang tiap `SSE_REVALIDATE_MS` — logout/kedaluwarsa → `event: end` `{"reason":"session"}` lalu
//    tutup.
//  - CR-5-6: resume `after = k > 0` mengirim ulang event `k` sekali dengan `repeat` terkini, lalu
//    event `> k`.
//  - CR-5-11: tick yang melempar → satu baris `[sse] tick gagal: <kelas error>` (tanpa pesan bebas
//    dari data) lalu stream ditutup; `SQLITE_BUSY` di-retry sekali dulu tanpa menutup stream.
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
export const SSE_MAX_PER_SESSION = 5
export const SSE_REVALIDATE_MS = 30_000

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform: kompresi Next/nginx tidak menahan stream.
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const

const KEY = Symbol.for("pxe.sseConnections")
const g = globalThis as typeof globalThis & { [KEY]?: { n: number; perSession: Map<string, number> } }
const counter = () => (g[KEY] ??= { n: 0, perSession: new Map() })

/** Reset penghitung koneksi (test; stream yang masih terbuka tetap menutup dirinya sendiri). */
export function resetSseCounters(): void {
  delete g[KEY]
}

/** Jumlah stream SSE log yang sedang terbuka (proses ini). */
export function sseConnections(): number {
  return counter().n
}

/** Jumlah stream SSE terbuka milik sesi `key` (idHash). */
export function sseConnectionsFor(key: string): number {
  return counter().perSession.get(key) ?? 0
}

/** Sesi pemilik stream: kunci (idHash) + pemeriksa validitas (dipanggil tiap `revalidateMs`). */
export type SseSession = { key: string; isValid: () => boolean }

export type SseOptions = {
  tickMs?: number
  heartbeatMs?: number
  maxAgeMs?: number
  revalidateMs?: number
  logger?: Pick<Console, "warn">
}

/** Kelas error untuk log (kode SQLite / nama error), tanpa pesan bebas. */
export function errorClass(e: unknown): string {
  const err = e as { errcode?: unknown; code?: unknown; name?: unknown } | null
  if (err && typeof err.errcode === "number") {
    const base = err.errcode & 0xff
    if (base === 5) return "SQLITE_BUSY"
    if (base === 6) return "SQLITE_LOCKED"
    return `SQLITE_${err.errcode}`
  }
  const raw = err && typeof err.code === "string" ? err.code : err && typeof err.name === "string" ? err.name : "Error"
  return raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "Error"
}

function isBusy(e: unknown): boolean {
  const c = errorClass(e)
  return c === "SQLITE_BUSY" || c === "SQLITE_LOCKED"
}

export type SseOpenResult =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; reason: "global" | "session" }

function logFrame(e: JobEvent): string {
  const data = { seq: e.seq, at: e.at, kind: e.kind, level: e.level, source: e.source, message: e.message, repeat: e.repeat, lastAt: e.lastAt }
  return `event: log\nid: ${e.seq}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Stream SSE log job `jobId` untuk sesi `session` (lihat header). Batas per sesi → `session`
 * (429), batas global → `global` (503). Pemanggil memastikan job ada sebelum memanggil.
 */
export function openJobLogStream(
  jobId: string,
  after: number,
  signal: AbortSignal | null,
  session: SseSession,
  opts: SseOptions = {},
): SseOpenResult {
  const c = counter()
  if ((c.perSession.get(session.key) ?? 0) >= SSE_MAX_PER_SESSION) return { ok: false, reason: "session" }
  const stream = jobLogStream(jobId, after, signal, opts, session)
  return stream ? { ok: true, stream } : { ok: false, reason: "global" }
}

/**
 * Stream SSE log job `jobId` mulai setelah `after`. null bila batas koneksi global tercapai (→ 503).
 * Pemanggil memastikan job ada sebelum memanggil. `session` opsional (dipakai `openJobLogStream`).
 */
export function jobLogStream(
  jobId: string,
  after: number,
  signal: AbortSignal | null,
  opts: SseOptions = {},
  session?: SseSession,
): ReadableStream<Uint8Array> | null {
  const c = counter()
  if (c.n >= SSE_MAX_CONNECTIONS) return null
  c.n++
  if (session) c.perSession.set(session.key, (c.perSession.get(session.key) ?? 0) + 1)
  const logger = opts.logger ?? console
  const revalidateMs = opts.revalidateMs ?? SSE_REVALIDATE_MS
  let authTimer: ReturnType<typeof setInterval> | undefined
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
    clearInterval(authTimer)
    if (onAbort) signal?.removeEventListener("abort", onAbort)
    c.n = Math.max(0, c.n - 1)
    if (session) {
      const left = (c.perSession.get(session.key) ?? 1) - 1
      if (left > 0) c.perSession.set(session.key, left)
      else c.perSession.delete(session.key)
    }
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

  // CR-5-6: `lastRepeat = 0` saat resume → event `after` dikirim ulang sekali dengan repeat terkini.
  let lastSeq = after
  let lastRepeat = 0
  let lastStatus: string | null = null
  let busyRetried = false

  const checkSession = () => {
    if (closed || !session) return
    let valid = false
    try {
      valid = session.isValid()
    } catch {
      valid = false
    }
    if (!valid) {
      send(`event: end\ndata: ${JSON.stringify({ reason: "session" })}\n\n`)
      close()
    }
  }

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
      busyRetried = false
    } catch (e) {
      if (isBusy(e) && !busyRetried) {
        // CR-5-11: kontensi SQLite sementara → ulangi sekali tanpa menutup stream.
        busyRetried = true
        tickTimer = setTimeout(tick, tickMs)
        return
      }
      logger.warn(`[sse] tick gagal: ${errorClass(e)}`)
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
      if (session) authTimer = setInterval(checkSession, revalidateMs)
      tick()
    },
    cancel() {
      close()
    },
  })
}
