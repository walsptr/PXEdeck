// DEC-027 §1 — target `action` native form login (`method="post"`). Hanya terpakai bila form
// tersubmit tanpa JavaScript klien (sebelum hydration / JS mati); login sesungguhnya lewat
// `fetch` JSON ke `POST /api/auth/login`.
//
// Body (urlencoded, berisi kredensial) SENGAJA tidak dibaca, tidak divalidasi, dan tidak dicatat:
// handler hanya mengembalikan 303 ke halaman login (GET, tanpa kredensial) dengan `next` yang
// disanitasi. Tidak ada sesi yang dibuat dan tidak ada nilai input yang dipantulkan.
// Tanpa ekspor GET: metode lain → 405 dari Next (GET ke sini tidak pernah dihasilkan form).
import { LOGIN_PATH, loginHref } from "@/lib/auth-next"

export function POST(req: Request): Response {
  const next = new URL(req.url).searchParams.get("next")
  return new Response(null, {
    status: 303,
    headers: {
      // Location relatif (RFC 9110): aman di belakang reverse proxy tanpa bergantung Host.
      Location: next === null ? LOGIN_PATH : loginHref(next),
      "Cache-Control": "no-store",
    },
  })
}
