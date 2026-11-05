// Repo `job_events` (M5, DEC-014 §3): log job append-only dengan `seq` naik ketat per job.
//  - `appendEvent` membersihkan dan meredaksi pesan sebelum disimpan — pertahanan berlapis walau
//    pemanggil sudah meredaksi. Urutan (SR-5-1): buang karakter kontrol → redaksi
//    (`redactSecrets`) → potong panjang. Redaksi setelah pembersihan agar secret yang disisipi
//    ESC/\x01 tidak lolos lalu "menyatu kembali" setelah karakter kontrolnya dibuang. Iterasi 3:
//    sekuens ANSI utuh (CR-5-18) dan karakter format Unicode Cf (SR-5-12) juga diperhitungkan;
//    deteksi dari salinan dengan dan tanpa sekuens ANSI digabung per karakter (SR-5-16/CR-5-24).
//    M6: pipeline pembersihan + redaksi (`stripControl`, `stripAnsi`, `cleanAndRedact`) pindah ke
//    `lib/server/redact.ts` (salinan ketiga `sgr`, salinan pencocokan ternormalisasi) dan diekspor
//    ulang dari sini; perilaku, batasan, dan sisa risikonya didokumentasikan di header modul itu.
//  - Penggabungan: event `system` identik (kind, level, source, message) dengan event terakhir job
//    yang kemunculan terakhirnya (`last_at`, CR-5-7) ≤ 60 dtk lalu → `repeat += 1`, `last_at` = waktu
//    event baru (seq tidak bertambah; `jobs.updated_at` berubah).
//  - Cap `PXE_JOB_LOG_MAX_EVENTS`: setelah `event_seq` ≥ cap, event `installer` dibuang dan satu
//    event `warn` "log dipotong" dicatat sekali; event `stage`/`system` tetap dicatat.
// Semua fungsi sinkron; panggil di dalam `tx` bila digabung dengan perubahan lain.
import { cleanAndRedact, stripControl } from "@/lib/server/redact"

import { getDb } from "../index"

export const JOB_EVENT_KINDS = ["stage", "system", "installer"] as const
export type JobEventKind = (typeof JOB_EVENT_KINDS)[number]
export const JOB_EVENT_LEVELS = ["info", "warn", "error"] as const
export type JobEventLevel = (typeof JOB_EVENT_LEVELS)[number]

export type JobEvent = {
  seq: number
  at: string
  kind: JobEventKind
  level: JobEventLevel
  /** install|boot-script|config-fetch|callback|watchdog|installer|operator */
  source: string
  message: string
  repeat: number
  /** Waktu kemunculan terakhir (CR-5-7); = `at` bila `repeat` 1. */
  lastAt: string
}

export type NewJobEvent = Omit<JobEvent, "seq" | "repeat" | "lastAt">

/** Panjang maksimum pesan (karakter) sebelum dipotong. */
export const EVENT_MESSAGE_MAX = 2048
export const TRUNCATED_SUFFIX = "…[dipotong]"
/** Jendela penggabungan event identik (ms). */
export const MERGE_WINDOW_MS = 60_000
export const LOG_TRUNCATED_MESSAGE = "Log installer dipotong: batas event per job tercapai, baris berikutnya dibuang"

// Pembersihan kontrol/ANSI + redaksi ada di `lib/server/redact.ts` (M6); diekspor ulang agar impor
// lama (`provisioning.ts`, test M5) tetap berlaku.
export { cleanAndRedact, stripAnsi, stripControl } from "@/lib/server/redact"

function truncateMessage(s: string): string {
  return s.length > EVENT_MESSAGE_MAX ? s.slice(0, EVENT_MESSAGE_MAX) + TRUNCATED_SUFFIX : s
}

/** Buang CR & karakter kontrol (kecuali \t), potong > EVENT_MESSAGE_MAX. */
export function sanitizeMessage(raw: string): string {
  return truncateMessage(stripControl(raw))
}

/** Pesan event: bersihkan kontrol/ANSI → redaksi → potong (SR-5-1, CR-5-18, lihat header). */
export function cleanEventMessage(raw: string): string {
  return truncateMessage(cleanAndRedact(raw))
}

type Row = Omit<JobEvent, "seq" | "repeat" | "lastAt"> & { seq: number; repeat: number; last_at: string | null }

function toEvent(r: Row): JobEvent {
  return {
    seq: Number(r.seq),
    at: r.at,
    kind: r.kind,
    level: r.level,
    source: r.source,
    message: r.message,
    repeat: Number(r.repeat),
    lastAt: r.last_at ?? r.at,
  }
}

export function lastEvent(jobId: string): JobEvent | null {
  const r = getDb()
    .prepare("SELECT * FROM job_events WHERE job_id = ? ORDER BY seq DESC LIMIT 1")
    .get(jobId) as Row | undefined
  return r ? toEvent(r) : null
}

export function getEvent(jobId: string, seq: number): JobEvent | null {
  const r = getDb()
    .prepare("SELECT * FROM job_events WHERE job_id = ? AND seq = ?")
    .get(jobId, seq) as Row | undefined
  return r ? toEvent(r) : null
}

/** Event dengan `seq > after`, urut naik, maks `limit`. */
export function eventsAfter(jobId: string, after: number, limit = 1000): JobEvent[] {
  return (
    getDb()
      .prepare("SELECT * FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(jobId, after, limit) as Row[]
  ).map(toEvent)
}

export function countEvents(jobId: string): number {
  const r = getDb().prepare("SELECT count(*) AS n FROM job_events WHERE job_id = ?").get(jobId) as {
    n: number
  }
  return Number(r.n)
}

export type AppendResult =
  | { status: "appended"; seq: number }
  | { status: "merged"; seq: number; repeat: number }
  | { status: "dropped" }

function insertRow(jobId: string, seq: number, e: NewJobEvent) {
  getDb()
    .prepare(
      `INSERT INTO job_events (job_id, seq, at, kind, level, source, message, repeat, last_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(jobId, seq, e.at, e.kind, e.level, e.source, e.message, e.at)
  getDb().prepare("UPDATE jobs SET event_seq = ?, updated_at = ? WHERE id = ?").run(seq, e.at, jobId)
}

/**
 * Tambah event ke job (lihat header). `maxEvents` = cap event per job. Job tidak ada → dropped.
 */
export function appendEvent(jobId: string, input: NewJobEvent, maxEvents: number): AppendResult {
  const db = getDb()
  const job = db.prepare("SELECT event_seq FROM jobs WHERE id = ?").get(jobId) as
    | { event_seq: number }
    | undefined
  if (!job) return { status: "dropped" }
  const e: NewJobEvent = {
    ...input,
    source: sanitizeMessage(input.source).slice(0, 32) || "-",
    message: cleanEventMessage(input.message),
  }
  const seq = Number(job.event_seq)

  if (e.kind === "system") {
    const last = lastEvent(jobId)
    if (
      last &&
      last.kind === "system" &&
      last.level === e.level &&
      last.source === e.source &&
      last.message === e.message &&
      // CR-5-7: jendela dihitung dari kemunculan TERAKHIR (`last_at`), bukan yang pertama.
      Date.parse(e.at) - Date.parse(last.lastAt) <= MERGE_WINDOW_MS &&
      Date.parse(e.at) >= Date.parse(last.lastAt)
    ) {
      db.prepare("UPDATE job_events SET repeat = repeat + 1, last_at = ? WHERE job_id = ? AND seq = ?").run(
        e.at,
        jobId,
        last.seq,
      )
      db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(e.at, jobId)
      return { status: "merged", seq: last.seq, repeat: last.repeat + 1 }
    }
  }

  if (e.kind === "installer" && seq >= maxEvents) {
    const marked = db
      .prepare("SELECT 1 FROM job_events WHERE job_id = ? AND kind = 'system' AND message = ? LIMIT 1")
      .get(jobId, LOG_TRUNCATED_MESSAGE)
    if (!marked) {
      insertRow(jobId, seq + 1, {
        at: e.at,
        kind: "system",
        level: "warn",
        source: "installer",
        message: LOG_TRUNCATED_MESSAGE,
      })
    }
    return { status: "dropped" }
  }

  insertRow(jobId, seq + 1, e)
  return { status: "appended", seq: seq + 1 }
}
