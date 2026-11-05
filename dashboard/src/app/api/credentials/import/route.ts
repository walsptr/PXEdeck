import { z } from "zod"

import { hostIdField, LIMITS } from "@/lib/host-config"
import { checkCredentialsCsv } from "@/lib/server/config-service"
import { readJson } from "@/lib/server/http"
import { mockDb } from "@/lib/server/mock-hosts"

const schema = z.object({
  csv: z.string().max(200_000),
  hostIds: z.array(hostIdField).min(1).max(LIMITS.hosts),
})

/** Validasi CSV mac,username,password per baris. Password tidak dikembalikan. */
export async function POST(req: Request) {
  const body = await readJson(req, schema)
  if ("response" in body) return body.response
  const { rows } = checkCredentialsCsv(
    mockDb(),
    body.data.csv,
    body.data.hostIds,
  )
  return Response.json({
    rows,
    valid: rows.filter((r) => r.errors.length === 0).length,
    invalid: rows.filter((r) => r.errors.length > 0).length,
  })
}
