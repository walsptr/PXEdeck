import { getHost } from "@/lib/server/db/repos/hosts"
import { guardMutation, hostIdParam, hostNotFound } from "@/lib/server/http"

/**
 * "Reboot ke PXE" nyata butuh IPMI/Redfish (di luar M4, docs/design/M4-plan.md
 * §1). Id bukan 12 hex → 400; host tidak ada → 404; selain itu 501 `{error}`:
 * reboot host secara manual (instalasi tetap dimulai lewat endpoint install).
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/hosts/[id]/reboot">,
) {
  const g = guardMutation(req, "none")
  if (g) return g
  const p = hostIdParam((await ctx.params).id)
  if ("response" in p) return p.response
  if (!getHost(p.id)) return hostNotFound()
  return Response.json(
    {
      error:
        "Reboot ke PXE belum didukung (butuh IPMI/Redfish) — reboot host secara manual",
    },
    { status: 501 },
  )
}
