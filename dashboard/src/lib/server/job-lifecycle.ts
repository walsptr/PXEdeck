// Siklus hidup job (M5-T3, DEC-014, plan §2.3): event job, transisi gagal, sapuan timeout.
//
// Mesin status: booting → installing → configuring → done; status aktif apa pun → failed.
// `sweepJobs(now)` menandai job aktif yang melewati timeout tahap (absolut sejak "masuk tahap" =
// `at` entri `stages` PERTAMA yang statusnya = status job, DEC-016 §1: penyajian ulang installer
// menambah entri `booting` tetapi tidak mereset timer Booting) sebagai `failed` dengan
// `failure_reason = timeout-<tahap>`, mencabut token, dan mencatat satu event `error`. Idempoten,
// sinkron, di dalam `tx` (BEGIN IMMEDIATE). Dipanggil secara lazy di setiap baca status (API/boot)
// dan oleh timer `startWatchdog()` (watchdog.ts).
import { getDb, tx } from "@/lib/server/db"
import { setHostStatus } from "@/lib/server/db/repos/hosts"
import { appendEvent, type AppendResult, type NewJobEvent } from "@/lib/server/db/repos/job-events"
import {
  getJob,
  listActiveJobs,
  updateJob,
  type FailureReason,
  type Job,
  type JobStatus,
} from "@/lib/server/db/repos/jobs"
import { getSettings, type JobTimeouts } from "@/lib/server/settings"

/** Label tahap (Indonesia/UI) untuk pesan event. */
export const STAGE_LABEL: Record<JobStatus, string> = {
  booting: "Booting",
  installing: "Installing",
  configuring: "Configuring",
  done: "Done",
  failed: "Failed",
}

/** Catat event job dengan cap dari settings. Panggil di dalam `tx` bila bagian dari transisi. */
export function logJobEvent(jobId: string, e: NewJobEvent): AppendResult {
  return appendEvent(jobId, e, getSettings().jobLogMaxEvents)
}

/**
 * Tandai job aktif gagal: status `failed`, alasan, stage `{failed, at, source}`, `finished_at`,
 * token dicabut; host `failed`; satu event `error`. Panggil di dalam `tx`.
 */
export function failJob(
  job: Job,
  reason: FailureReason,
  at: string,
  source: string,
  message: string,
): void {
  updateJob(
    job.id,
    {
      status: "failed",
      failureReason: reason,
      stages: [...job.stages, { stage: "failed", at, source }],
      finishedAt: at,
      tokenHash: null,
      tokenExpiresAt: null,
    },
    at,
  )
  setHostStatus(job.hostId, "failed", at)
  logJobEvent(job.id, { at, kind: "stage", level: "error", source, message })
}

/**
 * Waktu masuk tahap status job saat ini (ms epoch) = entri `stages` pertama untuk status itu
 * (DEC-016 §1). Booting: entri `booting` pertama (job dibuat), bukan penyajian installer terakhir.
 * Mesin status hanya maju, jadi tiap tahap lain hanya punya satu entri.
 */
export function stageEnteredAt(job: Job): number {
  const first = job.stages.find((s) => s.stage === job.status)
  return first ? Date.parse(first.at) : Date.parse(job.createdAt)
}

/** Timeout (menit) tahap aktif, atau null untuk status final. */
export function stageTimeoutMin(status: JobStatus, t: JobTimeouts): number | null {
  switch (status) {
    case "booting":
      return t.bootingMin
    case "installing":
      return t.installingMin
    case "configuring":
      return t.configuringMin
    default:
      return null
  }
}

/** Pesan event timeout, mis. "Timeout di tahap Installing (> 15 mnt)". */
export function timeoutMessage(status: JobStatus, minutes: number): string {
  return `Timeout di tahap ${STAGE_LABEL[status]} (> ${minutes} mnt)`
}

/** true bila job aktif sudah melewati timeout tahapnya pada `now`. */
function isOverdue(job: Job, now: Date, t: JobTimeouts): boolean {
  const min = stageTimeoutMin(job.status, t)
  return min !== null && now.getTime() - stageEnteredAt(job) > min * 60_000
}

/**
 * Sapuan timeout (lihat header). `hostId` membatasi ke satu host (jalur `/boot`). Mengembalikan
 * id job yang baru ditandai gagal.
 *
 * CR-5-3: pra-cek TANPA transaksi (baca biasa, tidak mengambil write lock) — bila tidak ada job
 * yang jatuh tempo, tidak ada `BEGIN IMMEDIATE` sehingga request baca tidak menjadi penulis dan
 * tidak menunggu lock penulis lain. Bila ada kandidat, transaksi dibuka dan job dibaca ulang di
 * dalamnya (status bisa sudah berubah). Di dalam transaksi luar (`tx` bertingkat, mis.
 * `installHosts`) pra-cek tetap aman karena memakai koneksi yang sama.
 */
export function sweepJobs(now: Date = new Date(), hostId?: string): string[] {
  const t = getSettings().jobTimeouts
  getDb()
  const candidates = listActiveJobs(hostId).filter((j) => isOverdue(j, now, t))
  if (!candidates.length) return []
  return tx(() => {
    const failed: string[] = []
    for (const c of candidates) {
      const job = getJob(c.id)
      if (!job || !isOverdue(job, now, t)) continue
      const min = stageTimeoutMin(job.status, t)!
      const reason = `timeout-${job.status}` as FailureReason
      failJob(job, reason, now.toISOString(), "watchdog", timeoutMessage(job.status, min))
      failed.push(job.id)
    }
    return failed
  })
}

/** Ambil ulang job (setelah sapuan). */
export function reloadJob(id: string): Job | null {
  return getJob(id)
}
