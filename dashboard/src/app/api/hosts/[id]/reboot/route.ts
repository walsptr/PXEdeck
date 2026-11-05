import { guardMutation, hostIdParam, hostNotFound } from "@/lib/server/http"
import { rebootToPxe } from "@/lib/server/mock-hosts"

/** Id bukan 12 hex → 400; host tidak ada → 404; selain itu 200 host baru. */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/hosts/[id]/reboot">,
) {
  const g = guardMutation(req, "none")
  if (g) return g
  const p = hostIdParam((await ctx.params).id)
  if ("response" in p) return p.response
  const host = rebootToPxe(p.id)
  return host ? Response.json(host) : hostNotFound()
}
