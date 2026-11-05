import { guardMutation, readJson } from "@/lib/server/http"
import { removeSshKey, renameSshKey, renameSshKeyPayload } from "@/lib/server/library-service"

/**
 * Ubah nama key (M5): body `{name}` (1–64, field lain → 400) → 200 `SshKeyInfo`; 404 tidak ada;
 * 403/415 lewat `guardMutation`. Public key & fingerprint tidak bisa diubah.
 */
export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/ssh-keys/[id]">,
) {
  const g = guardMutation(req, "json")
  if (g) return g
  const id = (await ctx.params).id.slice(0, 64)
  const body = await readJson(req, renameSshKeyPayload)
  if ("response" in body) return body.response
  const r = renameSshKey(id, body.data.name)
  return r.ok
    ? Response.json(r.value)
    : Response.json({ error: r.error }, { status: r.status })
}

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
