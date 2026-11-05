// Repo `jobs` (M4 minimal: status, stages, token; log & listing = M5).
import { getDb } from "../index"

export const JOB_STATUSES = ["booting", "installing", "configuring", "done", "failed"] as const
export type JobStatus = (typeof JOB_STATUSES)[number]
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["booting", "installing", "configuring"]

export type JobStage = {
  stage: JobStatus | "boot-served"
  at: string
  /** Asal sinyal: "install", "boot-script", "config-fetch", "callback", … */
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

export function insertJob(j: Job): void {
  getDb()
    .prepare(
      `INSERT INTO jobs (id, host_id, kind, os_image_id, status, stages, token_hash,
        token_expires_at, boot_served_at, created_at, updated_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    )
}

export type JobPatch = Partial<
  Pick<Job, "status" | "stages" | "tokenHash" | "tokenExpiresAt" | "bootServedAt" | "finishedAt">
>

const COLS: Record<keyof JobPatch, string> = {
  status: "status",
  stages: "stages",
  tokenHash: "token_hash",
  tokenExpiresAt: "token_expires_at",
  bootServedAt: "boot_served_at",
  finishedAt: "finished_at",
}

export function updateJob(id: string, patch: JobPatch, at: string): void {
  const keys = (Object.keys(patch) as (keyof JobPatch)[]).filter((k) => patch[k] !== undefined)
  const vals = keys.map((k) =>
    k === "stages" ? JSON.stringify(patch.stages) : (patch[k] as string | null),
  )
  const sets = [...keys.map((k) => `${COLS[k]} = ?`), "updated_at = ?"].join(", ")
  getDb().prepare(`UPDATE jobs SET ${sets} WHERE id = ?`).run(...vals, at, id)
}

/** Cabut token semua job aktif host lalu tandai gagal (install ulang). */
export function supersedeActiveJobs(hostId: string, at: string): void {
  getDb()
    .prepare(
      `UPDATE jobs SET status = 'failed', token_hash = NULL, token_expires_at = NULL,
        finished_at = ?, updated_at = ? WHERE host_id = ? AND ${ACTIVE_SQL}`,
    )
    .run(at, at, hostId)
}

/** Cabut token job yang sudah final (pembersihan defensif). */
export function revokeFinishedTokens(): void {
  getDb()
    .prepare(
      "UPDATE jobs SET token_hash = NULL, token_expires_at = NULL WHERE status IN ('done','failed') AND token_hash IS NOT NULL",
    )
    .run()
}
