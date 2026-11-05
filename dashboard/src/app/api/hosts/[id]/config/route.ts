import { toPublicConfig } from "@/lib/server/config-service"
import { getConfig, mockDb } from "@/lib/server/mock-hosts"

/** Konfigurasi tersimpan (tanpa hash password). */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/hosts/[id]/config">,
) {
  const { id } = await ctx.params
  const s = mockDb()
  const host = s.hosts.get(id)
  if (!host)
    return Response.json({ error: "Host tidak ditemukan" }, { status: 404 })
  return Response.json(toPublicConfig(getConfig(s, host)))
}
