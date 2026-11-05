import { toPublicConfig } from "@/lib/server/config-service"
import { configOrDefault } from "@/lib/server/db/repos/configs"
import { getHost } from "@/lib/server/db/repos/hosts"
import { hostIdParam, hostNotFound, jsonNoStore } from "@/lib/server/http"

/**
 * Konfigurasi tersimpan (tanpa hash password). Host tanpa config → default
 * (tanpa credentials/key) TANPA menulis ke DB (CR-3-4). Id bukan 12 hex → 400.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/hosts/[id]/config">,
) {
  const p = hostIdParam((await ctx.params).id)
  if ("response" in p) return p.response
  const host = getHost(p.id)
  if (!host) return hostNotFound()
  return jsonNoStore(toPublicConfig(configOrDefault(host)))
}
