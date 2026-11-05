import { connection } from "next/server"

import { listJobs } from "@/lib/server/db/repos/jobs"
import { guardRead, jsonNoStore } from "@/lib/server/http"
import { sweepJobs } from "@/lib/server/job-lifecycle"
import { parseJobsQuery, toJobSummary, type JobsResponse } from "@/lib/server/jobs-service"

/**
 * `GET /api/jobs?hostId=&status=&limit=&before=` (M5): sapuan timeout dulu, lalu `JobsResponse`
 * `{jobs: JobSummary[], nextBefore, serverTime}` urut terbaru dulu (`created_at DESC, id DESC`).
 * `limit` 1–200 (default 50); `before` = `nextBefore` halaman sebelumnya. Param invalid / tak
 * dikenal / `before` tidak ada → 400. Tanpa token/hash token. no-store.
 */
export async function GET(req: Request) {
  const denied = guardRead(req)
  if (denied) return denied
  await connection()
  const q = parseJobsQuery(new URL(req.url).searchParams)
  if (!q.ok) return jsonNoStore({ error: q.error }, { status: 400 })
  sweepJobs(new Date())
  const page = listJobs(q.value)
  if (!page) return jsonNoStore({ error: "Query tidak valid: before: job tidak ditemukan" }, { status: 400 })
  const body: JobsResponse = {
    jobs: page.jobs.map(toJobSummary),
    nextBefore: page.nextBefore,
    serverTime: new Date().toISOString(),
  }
  return jsonNoStore(body)
}
