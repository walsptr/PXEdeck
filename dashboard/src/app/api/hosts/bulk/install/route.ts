import { installPayload } from "@/lib/host-config"
import { installHosts } from "@/lib/server/install-service"
import { guardMutation, readJson } from "@/lib/server/http"

export async function POST(req: Request) {
  const g = guardMutation(req, "json")
  if (g) return g
  const body = await readJson(req, installPayload)
  if ("response" in body) return body.response
  const result = installHosts(body.data.hostIds)
  return Response.json(result, { status: result.started.length ? 200 : 422 })
}
