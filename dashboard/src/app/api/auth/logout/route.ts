import { clearSessionCookieHeader, destroySessionId, readCookie } from "@/lib/server/auth/session"
import { guardMutation } from "@/lib/server/http"

/**
 * `POST /api/auth/logout` (M6): butuh sesi (401 tanpa sesi). Baris sesi dihapus dan cookie
 * dibersihkan (`Max-Age=0`) → 204. Body tidak diperlukan.
 */
export async function POST(req: Request) {
  const denied = guardMutation(req, "none")
  if (denied) return denied
  destroySessionId(readCookie(req.headers.get("cookie")))
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearSessionCookieHeader(), "Cache-Control": "no-store" },
  })
}
