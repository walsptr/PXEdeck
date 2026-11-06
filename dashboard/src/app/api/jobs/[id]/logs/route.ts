import { connection } from "next/server"

import { getJob } from "@/lib/server/db/repos/jobs"
import { sessionByHash } from "@/lib/server/auth/session"
import { currentSession, guardRead, jsonNoStore } from "@/lib/server/http"
import { sweepJobs } from "@/lib/server/job-lifecycle"
import { isJobId, jobLog, parseAfter } from "@/lib/server/jobs-service"
import { openJobLogStream, SSE_HEADERS } from "@/lib/server/sse"

/**
 * `GET /api/jobs/:id/logs` (M5, DEC-014 §5):
 *  - `Accept: text/event-stream` (dan bukan `?format=json`) → SSE (lib/server/sse.ts): resume via
 *    `Last-Event-ID` atau `?after=`; > 50 koneksi → 503; > 5 koneksi dari sesi yang sama → 429
 *    (SR-5-7). Sesi divalidasi ulang tiap 30 dtk (logout/kedaluwarsa → `event: end` reason session).
 *  - Selain itu → JSON `{events, lastSeq, final}` untuk event `seq > after` (maks 1000).
 * id tidak valid / `after` tidak valid → 400; job tidak ada → 404.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/jobs/[id]/logs">) {
  const denied = guardRead(req)
  if (denied) return denied
  await connection()
  const id = (await ctx.params).id
  if (!isJobId(id)) return jsonNoStore({ error: "ID job tidak valid" }, { status: 400 })
  const url = new URL(req.url)
  const sse =
    url.searchParams.get("format") !== "json" &&
    (req.headers.get("accept") ?? "").toLowerCase().includes("text/event-stream")
  const after = parseAfter(url.searchParams.get("after") ?? (sse ? req.headers.get("last-event-id") : null))
  if (after === null) return jsonNoStore({ error: "Parameter after tidak valid" }, { status: 400 })
  const pre = getJob(id)
  if (!pre) return jsonNoStore({ error: "Job tidak ditemukan" }, { status: 404 })
  sweepJobs(new Date(), pre.hostId)
  if (!sse) return jsonNoStore(jobLog(getJob(id)!, after))
  const session = currentSession(req)
  if (!session) return jsonNoStore({ error: "Perlu login" }, { status: 401 })
  const opened = openJobLogStream(id, after, req.signal, {
    key: session.idHash,
    isValid: () => sessionByHash(session.idHash, new Date(), false) !== null,
  })
  if (!opened.ok) {
    return opened.reason === "session"
      ? jsonNoStore({ error: "Terlalu banyak koneksi log untuk sesi ini" }, { status: 429, headers: { "Retry-After": "5" } })
      : jsonNoStore({ error: "Terlalu banyak koneksi log" }, { status: 503, headers: { "Retry-After": "5" } })
  }
  return new Response(opened.stream, { headers: SSE_HEADERS })
}
