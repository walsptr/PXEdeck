import { connection } from "next/server"

import { listHosts } from "@/lib/server/db/repos/hosts"
import { syncLeases } from "@/lib/server/discovery"
import { guardRead, jsonNoStore } from "@/lib/server/http"
import { sweepJobs } from "@/lib/server/job-lifecycle"
import { lastJobsByHost } from "@/lib/server/jobs-service"
import type { HostsResponse } from "@/lib/types"

/**
 * Daftar host. M5: sapuan timeout job dulu (DEC-014 §2) dan setiap host memuat `lastJob`
 * `{id, status, failureReason, createdAt} | null` (job terbaru host).
 */
export async function GET(req: Request) {
  const denied = guardRead(req)
  if (denied) return denied
  await connection()
  // MAC baru di file lease dnsmasq muncul sebagai host `discovered` (AC-4.11).
  syncLeases()
  sweepJobs(new Date())
  const last = lastJobsByHost()
  const body: HostsResponse = {
    hosts: listHosts().map((h) => ({ ...h, lastJob: last.get(h.id) ?? null })),
    serverTime: new Date().toISOString(),
  }
  return jsonNoStore(body)
}
