import { connection } from "next/server"

import { guardMutation, guardRead, jsonNoStore, readJson } from "@/lib/server/http"
import { createSshKey, listSshKeyInfos, newSshKeyPayload } from "@/lib/server/library-service"

/** Library SSH key (public key saja) + `usedBy` (jumlah host, M5). */
export async function GET(req: Request) {
  const denied = guardRead(req)
  if (denied) return denied
  await connection()
  return jsonNoStore(listSshKeyInfos())
}

/**
 * Tambah key ke library. Body `{name, publicKey}` → 201 `SshKey`;
 * 400 skema; 409 fingerprint sudah ada; 422 key tidak valid/private key.
 */
export async function POST(req: Request) {
  const g = guardMutation(req, "json")
  if (g) return g
  const body = await readJson(req, newSshKeyPayload)
  if ("response" in body) return body.response
  const r = await createSshKey(body.data)
  return r.ok
    ? Response.json(r.value, { status: 201 })
    : Response.json({ error: r.error }, { status: r.status })
}
