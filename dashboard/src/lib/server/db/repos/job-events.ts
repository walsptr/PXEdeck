// Repo `job_events` (M5, DEC-014 §3): log job append-only dengan `seq` naik ketat per job.
//  - `appendEvent` membersihkan dan meredaksi pesan sebelum disimpan — pertahanan berlapis walau
//    pemanggil sudah meredaksi. Urutan (SR-5-1): buang karakter kontrol → redaksi
//    (`redactSecrets`) → potong panjang. Redaksi setelah pembersihan agar secret yang disisipi
//    ESC/\x01 tidak lolos lalu "menyatu kembali" setelah karakter kontrolnya dibuang. Iterasi 3:
//    sekuens ANSI utuh (CR-5-18) dan karakter format Unicode Cf (SR-5-12) juga diperhitungkan;
//    deteksi dari salinan dengan dan tanpa sekuens ANSI digabung per karakter (SR-5-16/CR-5-24).
//  - Penggabungan: event `system` identik (kind, level, source, message) dengan event terakhir job
//    yang `at`-nya ≤ 60 dtk lalu → `repeat += 1` (seq tidak bertambah; `jobs.updated_at` berubah).
//  - Cap `PXE_JOB_LOG_MAX_EVENTS`: setelah `event_seq` ≥ cap, event `installer` dibuang dan satu
//    event `warn` "log dipotong" dicatat sekali; event `stage`/`system` tetap dicatat.
// Semua fungsi sinkron; panggil di dalam `tx` bila digabung dengan perubahan lain.
import { markPlaceholder, secretMarks } from "@/lib/server/redact"

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
}

export type NewJobEvent = Omit<JobEvent, "seq" | "repeat">

/** Panjang maksimum pesan (karakter) sebelum dipotong. */
export const EVENT_MESSAGE_MAX = 2048
export const TRUNCATED_SUFFIX = "…[dipotong]"
/** Jendela penggabungan event identik (ms). */
export const MERGE_WINDOW_MS = 60_000
export const LOG_TRUNCATED_MESSAGE = "Log installer dipotong: batas event per job tercapai, baris berikutnya dibuang"

// C0 (kecuali \t), DEL, C1, U+2028/U+2029 (pemisah baris), dan karakter format Unicode (kategori
// Cf: U+00AD, U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+FEFF, dst. — SR-5-12) yang tak terlihat
// tetapi memecah pola secret. Ditulis dengan escape agar sumber tetap ASCII.
const CONTROL_CLASS_BASE = "\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f\\u2028\\u2029\\p{Cf}"
const CONTROL_RE = new RegExp(`[\\x00-\\x08\\x0a\\x0d${CONTROL_CLASS_BASE}]`, "gu")
// Sama dengan CONTROL_RE tetapi mempertahankan \n dan \r (untuk body log multi-baris).
const CONTROL_KEEP_NL_RE = new RegExp(`[\\x00-\\x08${CONTROL_CLASS_BASE}]`, "gu")

// Sekuens escape ANSI utuh (CR-5-18): CSI `ESC[ … final`, CSI 8-bit `\x9b … final`, OSC
// `ESC] … BEL|ESC\` (tidak melewati baris), dan escape dua/tiga byte lain (`ESC(B`, `ESC=`, …).
const ANSI_RE = new RegExp(
  [
    "\\x1b\\[[0-?]*[ -/]*[@-~]",
    "\\x9b[0-?]*[ -/]*[@-~]",
    "\\x1b\\][^\\x07\\x1b\\n]*(?:\\x07|\\x1b\\\\)",
    "\\x1b[ -/]*[0-~]",
  ].join("|"),
  "g",
)

/**
 * Buang karakter kontrol & format (kecuali \t; `keepNewlines` juga mempertahankan \n/\r). Tanpa
 * pemotongan panjang.
 */
export function stripControl(raw: string, keepNewlines = false): string {
  return raw.replace(keepNewlines ? CONTROL_KEEP_NL_RE : CONTROL_RE, "")
}

/** Buang sekuens escape ANSI utuh (CSI/OSC/escape lain), tanpa menyentuh karakter lain. */
export function stripAnsi(raw: string): string {
  return raw.replace(ANSI_RE, "")
}

/** Salinan teks + `map[i]` = indeks karakter ke-i salinan di teks mentah. */
type View = { text: string; map: Int32Array }

/** Hapus setiap kecocokan `re` dari `v`, sambil mempertahankan peta indeks ke teks mentah. */
function dropMatches(v: View, re: RegExp): View {
  const parts: string[] = []
  const map = new Int32Array(v.text.length)
  let n = 0
  let last = 0
  const keep = (from: number, to: number) => {
    parts.push(v.text.slice(from, to))
    map.set(v.map.subarray(from, to), n)
    n += to - from
  }
  for (const m of v.text.matchAll(re)) {
    keep(last, m.index)
    last = m.index + m[0].length
  }
  keep(last, v.text.length)
  return { text: parts.join(""), map: map.subarray(0, n) }
}

/**
 * Bersihkan lalu redaksi (CR-5-18, SR-5-16, CR-5-24). Dua salinan dibuat dari teks mentah, masing-
 * masing dengan peta indeks ke teks mentah:
 *  - `plain` = karakter kontrol dibuang (termasuk byte ESC/\x9b saja; sisa `[31m` tetap — AC-5.13);
 *  - `bare`  = sekuens ANSI dibuang utuh dulu, lalu karakter kontrol.
 * Secret dideteksi di KEDUA salinan (`secretMarks`) dan ditandai per karakter mentah (gabungan).
 * Tanpa secret → `plain` dikembalikan apa adanya. Bila `bare` memuat secret, output dirender dari
 * `bare`; bila hanya `plain`, dari `plain`. Setiap karakter mentah yang ditandai di salinan mana pun
 * diganti placeholder. Dengan begitu `stripAnsi` yang ikut menelan karakter awal secret (`ESC-----B`,
 * `ESC$6`, `ESC/b`, `ESC[t`, `token=<20>ESC<23>`) tidak lagi meloloskan sisa secret: salinan `plain`
 * tetap melihat secret utuh, dan tandanya terbawa ke output `bare`.
 */
export function cleanAndRedact(raw: string, keepNewlines = false): string {
  const ctrl = keepNewlines ? CONTROL_KEEP_NL_RE : CONTROL_RE
  const rawView: View = { text: raw, map: Int32Array.from({ length: raw.length }, (_, i) => i) }
  const plain = dropMatches(rawView, ctrl)
  const bare = dropMatches(dropMatches(rawView, ANSI_RE), ctrl)
  // marked[j] = kode sentinel (0 = tidak disamarkan) untuk karakter mentah ke-j.
  const marked = new Uint16Array(raw.length)
  const mark = (v: View): boolean => {
    const ms = secretMarks(v.text)
    if (ms === v.text) return false
    let found = false
    for (let i = 0; i < ms.length; i++) {
      if (ms.charCodeAt(i) !== v.text.charCodeAt(i)) {
        marked[v.map[i]] = ms.charCodeAt(i)
        found = true
      }
    }
    return found
  }
  const inPlain = mark(plain)
  const inBare = mark(bare)
  if (!inPlain && !inBare) return plain.text
  const base = inBare ? bare : plain
  const out: string[] = []
  let runStart = 0
  let prev = 0
  for (let i = 0; i <= base.text.length; i++) {
    const k = i < base.text.length ? marked[base.map[i]] : 0
    if (k === prev) continue
    if (prev === 0) out.push(base.text.slice(runStart, i))
    else out.push(markPlaceholder(String.fromCharCode(prev)))
    runStart = i
    prev = k
  }
  if (prev === 0) out.push(base.text.slice(runStart))
  return out.join("")
}

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

type Row = Omit<JobEvent, "seq" | "repeat"> & { seq: number; repeat: number }

function toEvent(r: Row): JobEvent {
  return {
    seq: Number(r.seq),
    at: r.at,
    kind: r.kind,
    level: r.level,
    source: r.source,
    message: r.message,
    repeat: Number(r.repeat),
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
      `INSERT INTO job_events (job_id, seq, at, kind, level, source, message, repeat)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(jobId, seq, e.at, e.kind, e.level, e.source, e.message)
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
      Date.parse(e.at) - Date.parse(last.at) <= MERGE_WINDOW_MS &&
      Date.parse(e.at) >= Date.parse(last.at)
    ) {
      db.prepare("UPDATE job_events SET repeat = repeat + 1 WHERE job_id = ? AND seq = ?").run(
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
