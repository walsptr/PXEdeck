import { connection } from "next/server"

import { currentSession, guardRead, jsonNoStore } from "@/lib/server/http"

/** Bentuk `GET /api/auth/session`. */
export type SessionResponse = { username: string; expiresAt: string }

/**
 * `GET /api/auth/session` (M6) → `{username, expiresAt}` untuk sesi aktif; tanpa sesi → 401
 * `{"error":"Perlu login"}` (dari `guardRead`). Memperpanjang idle seperti request API lain.
 */
export async function GET(req: Request) {
  const denied = guardRead(req)
  if (denied) return denied
  await connection()
  const s = currentSession(req)
  if (!s) return jsonNoStore({ error: "Perlu login" }, { status: 401 })
  const body: SessionResponse = { username: s.username, expiresAt: s.expiresAt }
  return jsonNoStore(body)
}
