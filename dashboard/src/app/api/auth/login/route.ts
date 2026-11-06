import { z } from "zod"

import { login, LOGIN_FAILED, LOGIN_LOCKED } from "@/lib/server/auth/login-service"
import { readCookie, sessionCookieHeader } from "@/lib/server/auth/session"
import { guardMutation, jsonNoStore, readJson } from "@/lib/server/http"
import { requestIp } from "@/lib/server/request-ip"

const loginPayload = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .strict()

/**
 * `POST /api/auth/login` `{username, password}` (M6, DEC-017):
 *  - Host/Origin/`Sec-Fetch-Site`/JSON seperti mutasi lain (403/415); body salah → 400; > 1 MB → 413.
 *  - Benar → 204 + `Set-Cookie: pxe_session=…; HttpOnly; SameSite=Strict; Path=/` (+ `Secure` bila
 *    `PXE_BASE_URL` https). Id sesi baru tiap login; sesi lama di cookie request dihapus.
 *  - Salah (password salah, username tak dikenal, admin belum dikonfigurasi) → 401 seragam
 *    `{"error":"Username atau password salah"}`.
 *  - Terkunci (per IP+username / per IP) → 429 `{"error": …}` + `Retry-After` (detik).
 * Satu-satunya route API tanpa sesi.
 */
export async function POST(req: Request) {
  const denied = guardMutation(req, "json", { session: false })
  if (denied) return denied
  const body = await readJson(req, loginPayload)
  if ("response" in body) return body.response
  const out = await login(body.data, requestIp(req), readCookie(req.headers.get("cookie")))
  if (out.status === "locked")
    return jsonNoStore(
      { error: LOGIN_LOCKED },
      { status: 429, headers: { "Retry-After": String(out.retryAfterSec) } },
    )
  if (out.status === "invalid") return jsonNoStore({ error: LOGIN_FAILED }, { status: 401 })
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": sessionCookieHeader(out.id), "Cache-Control": "no-store" },
  })
}
