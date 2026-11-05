import { installHosts } from "@/lib/server/config-service"

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/hosts/[id]/install">,
) {
  const { id } = await ctx.params
  const result = installHosts([id])
  return Response.json(result, { status: result.started.length ? 200 : 422 })
}
