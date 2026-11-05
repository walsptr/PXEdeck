import { connection } from "next/server"

import { logBootDenied, notFoundUniform, textResponse } from "@/lib/server/boot-http"
import { serveConfigFile } from "@/lib/server/provisioning"
import { requestIp } from "@/lib/server/request-ip"

/**
 * `GET /boot/{mac}/{token}/{file}` — file konfigurasi installer
 * (Ubuntu `user-data|meta-data|vendor-data`, Debian `preseed.cfg`, Rocky
 * `ks.cfg`). 200 text/plain no-store; semua penolakan → 404 `not found`
 * identik (DEC-008). Token tidak pernah di-log.
 */
export async function GET(
  req: Request,
  ctx: RouteContext<"/boot/[name]/[token]/[file]">,
) {
  await connection()
  const { name, token, file } = await ctx.params
  const r = serveConfigFile({ mac: name, token, file, ip: requestIp(req) })
  if (!r.ok) {
    logBootDenied("file", name, r.reason)
    return notFoundUniform()
  }
  return textResponse(r.body, 200, r.contentType)
}
