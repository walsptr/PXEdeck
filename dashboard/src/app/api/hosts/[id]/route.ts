import { configPayload } from "@/lib/host-config"
import { applyConfig } from "@/lib/server/config-service"
import {
  guardMutation,
  guardRead,
  hostIdParam,
  jsonNoStore,
  hostNotFound,
  readJson,
  validationFailed,
} from "@/lib/server/http"
import { deleteHost, getHost } from "@/lib/server/db/repos/hosts"

// Id bukan 12 hex → 400; host tidak ada → 404; mutasi lewat guardMutation
// (403/415) — lihat lib/server/http.ts. DELETE meng-cascade config, join key,
// dan job (token job ikut tercabut).

export async function GET(req: Request, ctx: RouteContext<"/api/hosts/[id]">) {
  const denied = guardRead(req)
  if (denied) return denied
  const p = hostIdParam((await ctx.params).id)
  if ("response" in p) return p.response
  const host = getHost(p.id)
  if (!host) return hostNotFound()
  return jsonNoStore(host)
}

/** Terapkan konfigurasi ke satu host. */
export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/hosts/[id]">,
) {
  const g = guardMutation(req, "json")
  if (g) return g
  const p = hostIdParam((await ctx.params).id)
  if ("response" in p) return p.response
  if (!getHost(p.id)) return hostNotFound()
  const body = await readJson(req, configPayload)
  if ("response" in body) return body.response
  const res = await applyConfig([p.id], body.data)
  return res.ok ? Response.json(res.result) : validationFailed(res.errors)
}

export async function DELETE(
  req: Request,
  ctx: RouteContext<"/api/hosts/[id]">,
) {
  const g = guardMutation(req, "none")
  if (g) return g
  const p = hostIdParam((await ctx.params).id)
  if ("response" in p) return p.response
  if (!deleteHost(p.id)) return hostNotFound()
  return new Response(null, { status: 204 })
}
