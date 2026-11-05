import { connection } from "next/server"

import { listImages, toImageInfo } from "@/lib/server/db/repos/os-images"
import { guardMutation, guardRead, jsonNoStore, readJson } from "@/lib/server/http"
import { createOsImage, newOsImagePayload } from "@/lib/server/library-service"
import { getSettings } from "@/lib/server/settings"

/**
 * Katalog OS image + ketersediaan media (`OsImageInfo[]`), M5: + `source`, `repoUrl`, `usedBy`
 * (jumlah host), `createdAt`.
 */
export async function GET(req: Request) {
  const denied = guardRead(req)
  if (denied) return denied
  await connection()
  const s = getSettings()
  return jsonNoStore(listImages().map((i) => toImageInfo(i, s.mediaRoot, s.mediaUrl)))
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
