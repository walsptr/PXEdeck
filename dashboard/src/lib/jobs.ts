// Logika tampilan job provisioning (M5-T8): teks alasan gagal, timeline tahap, durasi, dan
// penggabungan event log. Murni (tanpa React/DOM) agar bisa diuji di lingkungan node.
import type {
  FailureReason,
  JobLogEvent,
  JobStatus,
  JobSummary,
} from "@/lib/types"

/** Timeout per tahap dari `GET /api/settings` (menit). */
export type JobTimeouts = {
  bootingMin: number
  installingMin: number
  configuringMin: number
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  booting: "Booting",
  installing: "Installing",
  configuring: "Configuring",
  done: "Done",
  failed: "Failed",
}

const TIMEOUT_STAGE: Record<string, { label: string; key: keyof JobTimeouts }> = {
  "timeout-booting": { label: "Booting", key: "bootingMin" },
  "timeout-installing": { label: "Installing", key: "installingMin" },
  "timeout-configuring": { label: "Configuring", key: "configuringMin" },
}

/**
 * Teks alasan gagal (bahasa Indonesia), mis. "Timeout di tahap Installing (> 15 mnt)". Nilai N
 * dari `settings.jobTimeouts`; bila settings belum dimuat, bagian "(> N mnt)" dihilangkan.
 * Alasan yang tidak dikenal ditampilkan apa adanya.
 */
export function failureReasonText(
  reason: FailureReason | string | null | undefined,
  opts: { timeouts?: JobTimeouts; maxInstallerBoots?: number } = {},
): string | null {
  if (!reason) return null
  const t = TIMEOUT_STAGE[reason]
  if (t) {
    const n = opts.timeouts?.[t.key]
    return `Timeout di tahap ${t.label}${n ? ` (> ${n} mnt)` : ""}`
  }
  switch (reason) {
    case "installer-boot-limit":
      return opts.maxInstallerBoots
        ? `Installer sudah dilayani ${opts.maxInstallerBoots}× tanpa kemajuan — host diarahkan boot lokal`
        : "Batas penyajian installer tercapai — host diarahkan boot lokal"
    case "installer-error":
      return "Installer melaporkan gagal"
    case "superseded":
      return "Digantikan job install yang lebih baru"
    default:
      return reason
  }
}

export const TIMELINE_STAGES = ["booting", "installing", "configuring"] as const

export type TimelineStep = {
  /** Tahap; slot terakhir `done` atau `failed`. */
  stage: JobStatus
  reached: boolean
  /** Waktu pertama kali tahap tercapai (ISO), null bila belum. */
  at: string | null
  /**
   * Lama di tahap ini (ms): sampai tahap berikutnya tercapai, atau sampai `now` bila tahap ini
   * masih berjalan. null untuk tahap final / belum tercapai.
   */
  durationMs: number | null
  /** Tahap yang sedang berjalan (job aktif). */
  current: boolean
}

function firstAt(job: JobSummary, stage: JobStatus): string | null {
  return job.stages.find((s) => s.stage === stage)?.at ?? null
}

/**
 * Timeline 4 slot: Booting → Installing → Configuring → Done (atau Failed). Waktu tahap =
 * entri `stages` pertama untuk tahap itu; `createdAt` dipakai untuk Booting bila tidak ada entri.
 * `now` = 0 (jam belum tersedia saat SSR) → durasi tahap berjalan null.
 */
export function jobTimeline(job: JobSummary, now: number): TimelineStep[] {
  const final: JobStatus = job.status === "failed" ? "failed" : "done"
  const order: JobStatus[] = [...TIMELINE_STAGES, final]
  const at = order.map((s) =>
    s === "booting" ? (firstAt(job, s) ?? job.createdAt) : firstAt(job, s),
  )
  if (final === "failed" && !at[3]) at[3] = job.finishedAt ?? job.updatedAt
  const active = job.status !== "done" && job.status !== "failed"
  return order.map((stage, i) => {
    const reached = at[i] !== null
    const current = active && stage === job.status
    let durationMs: number | null = null
    if (reached && i < 3) {
      const next = at.slice(i + 1).find((x) => x !== null)
      const end = next ? Date.parse(next) : current && now > 0 ? now : null
      if (end !== null) durationMs = Math.max(0, end - Date.parse(at[i]!))
    }
    return { stage, reached, at: at[i], durationMs, current }
  })
}

/** Durasi total job: sampai `finishedAt` (job final) atau `now` (job aktif). */
export function jobDurationMs(job: JobSummary, now: number): number {
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now
  return Math.max(0, end - Date.parse(job.createdAt))
}

/** "45 dtk", "3 mnt 12 dtk", "1 j 5 mnt". */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} dtk`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m} mnt ${s % 60} dtk` : `${m} mnt`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} j ${m % 60} mnt` : `${h} j`
}

const clock = new Intl.DateTimeFormat("id", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

/** "14:03:21" (zona waktu browser). */
export function formatClock(iso: string): string {
  return clock.format(new Date(iso)).replace(/\./g, ":")
}

export function isFinalJob(s: JobStatus): boolean {
  return s === "done" || s === "failed"
}

/**
 * Gabungkan event log baru ke daftar (urut `seq`). Event dengan `seq` yang sudah ada MENGGANTI
 * baris lama (penggabungan `repeat` / kirim ulang setelah reconnect), bukan menambah.
 */
export function mergeLogEvents(
  prev: readonly JobLogEvent[],
  incoming: readonly JobLogEvent[],
): JobLogEvent[] {
  if (incoming.length === 0) return prev as JobLogEvent[]
  const last = prev.length ? prev[prev.length - 1].seq : 0
  // Jalur cepat: semua event baru dan berurutan (kasus umum streaming).
  if (incoming.every((e, i) => e.seq > (i ? incoming[i - 1].seq : last)))
    return [...prev, ...incoming]
  const bySeq = new Map(prev.map((e) => [e.seq, e]))
  for (const e of incoming) bySeq.set(e.seq, e)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

/** Validasi ringan data event dari jaringan (SSE `event: log`). */
export function parseLogEvent(data: string): JobLogEvent | null {
  try {
    const e = JSON.parse(data) as Partial<JobLogEvent>
    if (
      typeof e.seq !== "number" ||
      typeof e.at !== "string" ||
      typeof e.message !== "string"
    )
      return null
    return {
      seq: e.seq,
      at: e.at,
      kind: e.kind ?? "system",
      level: e.level === "warn" || e.level === "error" ? e.level : "info",
      source: typeof e.source === "string" ? e.source : "",
      message: e.message,
      repeat: typeof e.repeat === "number" && e.repeat > 0 ? e.repeat : 1,
    }
  } catch {
    return null
  }
}

/** Query string `/jobs?host=&job=&status=` (nilai kosong dihilangkan). */
export function jobsHref(p: {
  host?: string | null
  job?: string | null
  status?: string | null
}): string {
  const q = new URLSearchParams()
  if (p.host) q.set("host", p.host)
  if (p.status) q.set("status", p.status)
  if (p.job) q.set("job", p.job)
  const s = q.toString()
  return s ? `/jobs?${s}` : "/jobs"
}
