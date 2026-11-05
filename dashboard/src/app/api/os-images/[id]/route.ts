import { guardMutation } from "@/lib/server/http"
import { removeOsImage } from "@/lib/server/library-service"

/** Hapus OS image: 204; 404 tidak ada; 409 masih dipakai host/job. */
export async function DELETE(
  req: Request,
  ctx: RouteContext<"/api/os-images/[id]">,
) {
  const g = guardMutation(req, "none")
  if (g) return g
  const id = (await ctx.params).id.slice(0, 64)
  const r = removeOsImage(id)
  return r.ok
    ? new Response(null, { status: 204 })
    : Response.json({ error: r.error }, { status: r.status })
}
