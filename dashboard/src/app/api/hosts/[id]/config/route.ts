import { toPublicConfig } from "@/lib/server/config-service"
import { hostIdParam, hostNotFound } from "@/lib/server/http"
import { getConfig, mockDb } from "@/lib/server/mock-hosts"

/** Konfigurasi tersimpan (tanpa hash password). Id bukan 12 hex → 400. */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/hosts/[id]/config">,
) {
  const p = hostIdParam((await ctx.params).id)
  if ("response" in p) return p.response
  const s = mockDb()
  const host = s.hosts.get(p.id)
  if (!host) return hostNotFound()
  return Response.json(toPublicConfig(getConfig(s, host)))
}
