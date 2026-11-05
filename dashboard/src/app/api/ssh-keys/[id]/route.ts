import { guardMutation } from "@/lib/server/http"
import { removeSshKey } from "@/lib/server/library-service"

/** Hapus key: 204; 404 tidak ada; 409 masih dipakai host. */
export async function DELETE(
  req: Request,
  ctx: RouteContext<"/api/ssh-keys/[id]">,
) {
  const g = guardMutation(req, "none")
  if (g) return g
  const id = (await ctx.params).id.slice(0, 64)
  const r = removeSshKey(id)
  return r.ok
    ? new Response(null, { status: 204 })
    : Response.json({ error: r.error }, { status: r.status })
}
