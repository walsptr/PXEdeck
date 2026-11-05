import { connection } from "next/server"

import { getJob } from "@/lib/server/db/repos/jobs"
import { guardRead, jsonNoStore } from "@/lib/server/http"
import { sweepJobs } from "@/lib/server/job-lifecycle"
import { isJobId, toJobSummary } from "@/lib/server/jobs-service"

/** `GET /api/jobs/:id` → `JobSummary` (sapuan dulu); id tidak valid → 400; tidak ada → 404. */
export async function GET(req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const denied = guardRead(req)
  if (denied) return denied
  await connection()
  const id = (await ctx.params).id
  if (!isJobId(id)) return jsonNoStore({ error: "ID job tidak valid" }, { status: 400 })
  const pre = getJob(id)
  if (!pre) return jsonNoStore({ error: "Job tidak ditemukan" }, { status: 404 })
  sweepJobs(new Date(), pre.hostId)
  return jsonNoStore(toJobSummary(getJob(id)!))
}
