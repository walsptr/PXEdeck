import { logBootDenied, notFoundUniform, textResponse } from "@/lib/server/boot-http"
import { readBodyLimited } from "@/lib/server/http"
import { handleLogPost, LOG_MAX_BODY_BYTES } from "@/lib/server/provisioning"
import { requestIp } from "@/lib/server/request-ip"

/**
 * `POST /boot/{mac}/{token}/log` — baris log dari installer (teks, `\n` per baris), M5 §2.4.
 * > 16 KB → 413 SEBELUM otorisasi (hasil tidak bergantung token). Otorisasi = callback status;
 * penolakan → 404 `not found` identik. > 200 baris → 413; > 60 request/menit per job → 429.
 * 200 `ok`. Token tidak pernah di-log.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/boot/[name]/[token]/log">,
) {
  const { name, token } = await ctx.params
  const text = await readBodyLimited(req, LOG_MAX_BODY_BYTES)
  if (text === null) return textResponse("payload too large\n", 413)
  const r = handleLogPost({ mac: name, token, text, ip: requestIp(req) })
  if (!r.ok) {
    if (r.status === 404) {
      logBootDenied("log", name, r.reason)
      return notFoundUniform()
    }
    return textResponse(r.status === 413 ? "payload too large\n" : "too many requests\n", r.status)
  }
  return textResponse("ok\n")
}
