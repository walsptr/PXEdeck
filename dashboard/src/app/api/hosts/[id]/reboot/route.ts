import { rebootToPxe } from "@/lib/server/mock-hosts"

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/hosts/[id]/reboot">,
) {
  const { id } = await ctx.params
  const host = rebootToPxe(id)
  if (!host)
    return Response.json({ error: "Host tidak ditemukan" }, { status: 404 })
  return Response.json(host)
}
