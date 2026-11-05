import { bulkPayload } from "@/lib/host-config"
import { applyConfig } from "@/lib/server/config-service"
import { readJson, validationFailed } from "@/lib/server/http"

/** Terapkan konfigurasi ke banyak host sekaligus (semua valid atau tidak sama sekali). */
export async function POST(req: Request) {
  const body = await readJson(req, bulkPayload)
  if ("response" in body) return body.response
  const { hostIds, ...payload } = body.data
  const res = await applyConfig(hostIds, payload)
  return res.ok ? Response.json(res.result) : validationFailed(res.errors)
}
