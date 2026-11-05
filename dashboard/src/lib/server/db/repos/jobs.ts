// Repo `jobs` (M4: status, stages, token; M5: failure_reason, installer_boots, event_seq,
// listing + cursor, riwayat per host, DEC-014). Semua fungsi sinkron (dipakai di dalam `tx`).
import { getDb } from "../index"

export const JOB_STATUSES = ["booting", "installing", "configuring", "done", "failed"] as const
export type JobStatus = (typeof JOB_STATUSES)[number]
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["booting", "installing", "configuring"]
export const FINAL_JOB_STATUSES: readonly JobStatus[] = ["done", "failed"]

export const FAILURE_REASONS = [
  "timeout-booting",
  "timeout-installing",
  "timeout-configuring",
  "installer-boot-limit",
  "installer-error",
  "superseded",
] as const
export type FailureReason = (typeof FAILURE_REASONS)[number]

export type JobStage = {
  stage: JobStatus
  at: string
  /** Asal sinyal: "install", "boot-script", "config-fetch", "callback", "watchdog", … */
  source: string
}

export type Job = {
  id: string
  hostId: string
  kind: "install"
  osImageId: string
  status: JobStatus
  stages: JobStage[]
  tokenHash: string | null
  tokenExpiresAt: string | null
  bootServedAt: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
  failureReason: FailureReason | null
  /** Jumlah penyajian script installer untuk job ini (CR-4-1). */
  installerBoots: number
  /** `seq` event terakhir (`job_events`). */
  eventSeq: number
}

type Row = {
  id: string
  host_id: string
  kind: "install"
  os_image_id: string
  status: JobStatus
  stages: string
  token_hash: string | null
  token_expires_at: string | null
  boot_served_at: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
  failure_reason: FailureReason | null
  installer_boots: number
  event_seq: number
}

function toJob(r: Row): Job {
  return {
    id: r.id,
    hostId: r.host_id,
    kind: r.kind,
    osImageId: r.os_image_id,
    status: r.status,
    stages: JSON.parse(r.stages) as JobStage[],
    tokenHash: r.token_hash,
    tokenExpiresAt: r.token_expires_at,
    bootServedAt: r.boot_served_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    finishedAt: r.finished_at,
    failureReason: r.failure_reason ?? null,
    installerBoots: Number(r.installer_boots ?? 0),
    eventSeq: Number(r.event_seq ?? 0),
  }
}

const ACTIVE_SQL = "status IN ('booting','installing','configuring')"

export function getJob(id: string): Job | null {
  const r = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined
  return r ? toJob(r) : null
}

export function getActiveJob(hostId: string): Job | null {
  const r = getDb()
    .prepare(`SELECT * FROM jobs WHERE host_id = ? AND ${ACTIVE_SQL}`)
    .get(hostId) as Row | undefined
  return r ? toJob(r) : null
}

/** Semua job aktif (untuk sapuan watchdog). */
export function listActiveJobs(hostId?: string): Job[] {
  const db = getDb()
  const rows = (
    hostId
      ? db.prepare(`SELECT * FROM jobs WHERE host_id = ? AND ${ACTIVE_SQL}`).all(hostId)
      : db.prepare(`SELECT * FROM jobs WHERE ${ACTIVE_SQL}`).all()
  ) as Row[]
  return rows.map(toJob)
}

export function getJobByTokenHash(hash: string): Job | null {
  const r = getDb().prepare("SELECT * FROM jobs WHERE token_hash = ?").get(hash) as
    | Row
    | undefined
  return r ? toJob(r) : null
}

export function listJobsForHost(hostId: string): Job[] {
  return (
    getDb()
      .prepare("SELECT * FROM jobs WHERE host_id = ? ORDER BY created_at, id")
      .all(hostId) as Row[]
  ).map(toJob)
}

export type ListJobsQuery = {
  hostId?: string
  status?: JobStatus
  /** 1–200. */
  limit: number
  /** Id job terakhir halaman sebelumnya (cursor). */
  before?: string
}

/**
 * Daftar job terbaru dulu (`created_at DESC, id DESC`), opsional filter host/status, cursor
 * `before` = id job terakhir halaman sebelumnya. `before` yang tidak dikenal → `null`
 * (pemanggil membalas 400). `nextBefore` null bila tidak ada halaman berikutnya.
 */
export function listJobs(q: ListJobsQuery): { jobs: Job[]; nextBefore: string | null } | null {
  const db = getDb()
  const where: string[] = []
  const args: (string | number)[] = []
  if (q.hostId) {
    where.push("host_id = ?")
    args.push(q.hostId)
  }
  if (q.status) {
    where.push("status = ?")
    args.push(q.status)
  }
  if (q.before) {
    const c = db.prepare("SELECT created_at, id FROM jobs WHERE id = ?").get(q.before) as
      | { created_at: string; id: string }
      | undefined
    if (!c) return null
    where.push("(created_at < ? OR (created_at = ? AND id < ?))")
    args.push(c.created_at, c.created_at, c.id)
  }
  const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC LIMIT ?`
  const rows = db.prepare(sql).all(...args, q.limit + 1) as Row[]
  const more = rows.length > q.limit
  const jobs = rows.slice(0, q.limit).map(toJob)
  return { jobs, nextBefore: more ? jobs[jobs.length - 1].id : null }
}

/** Job terbaru per host (untuk `lastJob` di `GET /api/hosts`). */
export function latestJobsByHost(): Map<string, Job> {
  const rows = getDb()
    .prepare(
      `SELECT * FROM (
         SELECT j.*, ROW_NUMBER() OVER (PARTITION BY host_id ORDER BY created_at DESC, id DESC) AS rn
         FROM jobs j
       ) WHERE rn = 1`,
    )
    .all() as Row[]
  return new Map(rows.map((r) => [r.host_id, toJob(r)]))
}

export function insertJob(j: Omit<Job, "failureReason" | "installerBoots" | "eventSeq"> & Partial<Job>): void {
  getDb()
    .prepare(
      `INSERT INTO jobs (id, host_id, kind, os_image_id, status, stages, token_hash,
        token_expires_at, boot_served_at, created_at, updated_at, finished_at,
        failure_reason, installer_boots, event_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      j.id,
      j.hostId,
      j.kind,
      j.osImageId,
      j.status,
      JSON.stringify(j.stages),
      j.tokenHash,
      j.tokenExpiresAt,
      j.bootServedAt,
      j.createdAt,
      j.updatedAt,
      j.finishedAt,
      j.failureReason ?? null,
      j.installerBoots ?? 0,
      j.eventSeq ?? 0,
    )
}

export type JobPatch = Partial<
  Pick<
    Job,
    | "status"
    | "stages"
    | "tokenHash"
    | "tokenExpiresAt"
    | "bootServedAt"
    | "finishedAt"
    | "failureReason"
    | "installerBoots"
  >
>

const COLS: Record<keyof JobPatch, string> = {
  status: "status",
  stages: "stages",
  tokenHash: "token_hash",
  tokenExpiresAt: "token_expires_at",
  bootServedAt: "boot_served_at",
  finishedAt: "finished_at",
  failureReason: "failure_reason",
  installerBoots: "installer_boots",
}

export function updateJob(id: string, patch: JobPatch, at: string): void {
  const keys = (Object.keys(patch) as (keyof JobPatch)[]).filter((k) => patch[k] !== undefined)
  const vals = keys.map((k) =>
    k === "stages" ? JSON.stringify(patch.stages) : (patch[k] as string | number | null),
  )
  const sets = [...keys.map((k) => `${COLS[k]} = ?`), "updated_at = ?"].join(", ")
  getDb().prepare(`UPDATE jobs SET ${sets} WHERE id = ?`).run(...vals, at, id)
}

/** Job aktif host (seharusnya ≤ 1) — dipakai sebelum install ulang untuk dicabut. */
export function activeJobIds(hostId: string): string[] {
  return (
    getDb().prepare(`SELECT id FROM jobs WHERE host_id = ? AND ${ACTIVE_SQL}`).all(hostId) as {
      id: string
    }[]
  ).map((r) => r.id)
}

/** Cabut token semua job aktif host lalu tandai gagal `superseded` (install ulang). */
export function supersedeActiveJobs(hostId: string, at: string): string[] {
  const ids = activeJobIds(hostId)
  for (const id of ids) {
    const j = getJob(id)!
    updateJob(
      id,
      {
        status: "failed",
        failureReason: "superseded",
        stages: [...j.stages, { stage: "failed", at, source: "install" }],
        tokenHash: null,
        tokenExpiresAt: null,
        finishedAt: at,
      },
      at,
    )
  }
  return ids
}

/**
 * Hapus job final tertua host di luar `keep` job final terbaru (DEC-014 §3). Event ikut terhapus
 * (cascade). Job aktif tidak disentuh. Mengembalikan jumlah job yang dihapus.
 */
export function pruneHostHistory(hostId: string, keep: number): number {
  const res = getDb()
    .prepare(
      `DELETE FROM jobs WHERE id IN (
         SELECT id FROM jobs WHERE host_id = ? AND status IN ('done','failed')
         ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?
       )`,
    )
    .run(hostId, keep)
  return Number(res.changes)
}

/** Cabut token job yang sudah final (pembersihan defensif). */
export function revokeFinishedTokens(): void {
  getDb()
    .prepare(
      "UPDATE jobs SET token_hash = NULL, token_expires_at = NULL WHERE status IN ('done','failed') AND token_hash IS NOT NULL",
    )
    .run()
}
