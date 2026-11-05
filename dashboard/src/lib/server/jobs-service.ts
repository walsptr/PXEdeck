// API job (M5-T6, plan §2.6): bentuk `JobSummary`, validasi query, log JSON. Token, hash token,
// dan masa berlaku token TIDAK PERNAH disajikan.
import { z } from "zod"

import { getHost } from "@/lib/server/db/repos/hosts"
import { eventsAfter, type JobEvent } from "@/lib/server/db/repos/job-events"
import {
  FINAL_JOB_STATUSES,
  JOB_STATUSES,
  latestJobsByHost,
  listJobs,
  type FailureReason,
  type Job,
  type JobStage,
  type JobStatus,
} from "@/lib/server/db/repos/jobs"

export type JobSummary = {
  id: string
  hostId: string
  host: { mac: string; hostname: string | null } | null
  /** `jobs.kind` (nama SPEC §5: `type`). */
  type: "install"
  osImageId: string
  status: JobStatus
  stages: JobStage[]
  failureReason: FailureReason | null
  installerBoots: number
  createdAt: string
  updatedAt: string
  finishedAt: string | null
  eventCount: number
}

export type JobsResponse = { jobs: JobSummary[]; nextBefore: string | null; serverTime: string }

/** Ringkasan job terakhir per host di `GET /api/hosts`. */
export type LastJob = {
  id: string
  status: JobStatus
  failureReason: FailureReason | null
  createdAt: string
}

export type JobLogResponse = { events: JobEvent[]; lastSeq: number; final: boolean }

export function toJobSummary(j: Job): JobSummary {
  const h = getHost(j.hostId)
  return {
    id: j.id,
    hostId: j.hostId,
    host: h ? { mac: h.mac, hostname: h.hostname } : null,
    type: j.kind,
    osImageId: j.osImageId,
    status: j.status,
    stages: j.stages.map((s) => ({ stage: s.stage, at: s.at, source: s.source })),
    failureReason: j.failureReason,
    installerBoots: j.installerBoots,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    finishedAt: j.finishedAt,
    eventCount: j.eventSeq,
  }
}

export function lastJobsByHost(): Map<string, LastJob> {
  const out = new Map<string, LastJob>()
  for (const [hostId, j] of latestJobsByHost()) {
    out.set(hostId, { id: j.id, status: j.status, failureReason: j.failureReason, createdAt: j.createdAt })
  }
  return out
}

export function lastJobForHost(hostId: string): LastJob | null {
  const j = listJobs({ hostId, limit: 1 })?.jobs[0]
  return j ? { id: j.id, status: j.status, failureReason: j.failureReason, createdAt: j.createdAt } : null
}

export function isFinal(status: JobStatus): boolean {
  return FINAL_JOB_STATUSES.includes(status)
}

/** Id job di URL/query: `job-<uuid>` (atau id lain yang aman), maks 64 karakter. */
export const JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isJobId(v: string): boolean {
  return JOB_ID_RE.test(v)
}

const intParam = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, "harus bilangan bulat")
    .transform(Number)
    .refine((n) => n >= min && n <= max, `harus ${min}–${max}`)

export const jobsQuery = z
  .object({
    hostId: z.string().regex(/^[0-9a-f]{12}$/, "harus 12 digit hex").optional(),
    status: z.enum(JOB_STATUSES).optional(),
    limit: intParam(1, 200).optional(),
    before: z.string().regex(JOB_ID_RE, "id job tidak valid").optional(),
  })
  .strict()

/** Parse query `GET /api/jobs`; error → pesan 400. */
export function parseJobsQuery(
  params: URLSearchParams,
): { ok: true; value: { hostId?: string; status?: JobStatus; limit: number; before?: string } } | { ok: false; error: string } {
  const raw: Record<string, string> = {}
  for (const [k, v] of params) {
    if (k in raw) return { ok: false, error: `Parameter ${k} ganda` }
    raw[k] = k === "hostId" ? v.toLowerCase() : v
  }
  const r = jobsQuery.safeParse(raw)
  if (!r.success) {
    const i = r.error.issues[0]
    return { ok: false, error: `Query tidak valid: ${i.path.join(".") || "parameter"}: ${i.message}` }
  }
  return { ok: true, value: { ...r.data, limit: r.data.limit ?? 50 } }
}

/** Batas event per respons log JSON. */
export const LOG_PAGE = 1000

/** `?after=` / `Last-Event-ID` → bilangan ≥ 0, atau null bila tidak valid. */
export function parseAfter(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return 0
  if (!/^\d{1,12}$/.test(v.trim())) return null
  return Number(v.trim())
}

/** Respons log JSON untuk job (setelah `after`). */
export function jobLog(job: Job, after: number): JobLogResponse {
  const events = eventsAfter(job.id, after, LOG_PAGE)
  const lastSeq = events.length ? events[events.length - 1].seq : Math.min(after, job.eventSeq)
  return { events, lastSeq, final: isFinal(job.status) && lastSeq >= job.eventSeq }
}
