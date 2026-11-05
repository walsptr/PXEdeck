import { installHosts } from "@/lib/server/install-service"
import { guardMutation, hostIdParam } from "@/lib/server/http"

/**
 * Id bukan 12 hex → 400. Selain itu bentuk `InstallResult` seperti endpoint
 * bulk: 200 bila host mulai install, 422 bila gagal (termasuk id tak dikenal,
 * dengan pesan di `failed[]`) — AC-3.11.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/hosts/[id]/install">,
) {
  const g = guardMutation(req, "none")
  if (g) return g
  const p = hostIdParam((await ctx.params).id)
  if ("response" in p) return p.response
  const result = installHosts([p.id])
  return Response.json(result, { status: result.started.length ? 200 : 422 })
}
