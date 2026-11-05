import { connection } from "next/server"

import { listImages, toImageInfo } from "@/lib/server/db/repos/os-images"
import { guardMutation, jsonNoStore, readJson } from "@/lib/server/http"
import { createOsImage, newOsImagePayload } from "@/lib/server/library-service"
import { getSettings } from "@/lib/server/settings"

/** Katalog OS image + ketersediaan media (`OsImageInfo[]`). */
export async function GET() {
  await connection()
  const root = getSettings().mediaRoot
  return jsonNoStore(listImages().map((i) => toImageInfo(i, root)))
}

/**
 * Tambah OS image. Body `{id, name, version, arch, method, bootable,
 * source:{kernel, initrd, repo}}` (path relatif PXE_MEDIA_ROOT) → 201
 * `OsImageInfo`; 400 skema; 409 id sudah ada.
 */
export async function POST(req: Request) {
  const g = guardMutation(req, "json")
  if (g) return g
  const body = await readJson(req, newOsImagePayload)
  if ("response" in body) return body.response
  const r = createOsImage(body.data)
  return r.ok
    ? Response.json(r.value, { status: 201 })
    : Response.json({ error: r.error }, { status: r.status })
}
