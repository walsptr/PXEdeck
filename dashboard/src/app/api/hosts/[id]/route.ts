import { configPayload } from "@/lib/host-config"
import { applyConfig } from "@/lib/server/config-service"
import { readJson, validationFailed } from "@/lib/server/http"
import { deleteHost, getHost } from "@/lib/server/mock-hosts"

const notFound = () =>
  Response.json({ error: "Host tidak ditemukan" }, { status: 404 })

export async function GET(_req: Request, ctx: RouteContext<"/api/hosts/[id]">) {
  const { id } = await ctx.params
  const host = getHost(id)
  return host ? Response.json(host) : notFound()
}

/** Terapkan konfigurasi ke satu host. */
export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/hosts/[id]">,
) {
  const { id } = await ctx.params
  if (!getHost(id)) return notFound()
  const body = await readJson(req, configPayload)
  if ("response" in body) return body.response
  const res = await applyConfig([id], body.data)
  return res.ok ? Response.json(res.result) : validationFailed(res.errors)
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/hosts/[id]">,
) {
  const { id } = await ctx.params
  if (!deleteHost(id)) return notFound()
  return new Response(null, { status: 204 })
}
