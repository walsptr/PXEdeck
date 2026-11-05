import { logBootDenied, notFoundUniform, textResponse } from "@/lib/server/boot-http"
import { readBodyLimited } from "@/lib/server/http"
import { handleStatusCallback, parseStageBody } from "@/lib/server/provisioning"
import { requestIp } from "@/lib/server/request-ip"

/**
 * `POST /boot/{mac}/{token}/status` body `stage=<installing|configuring|done|failed>`
 * (form atau JSON, ≤ 1 KB). 200 `ok` (termasuk no-op stage sama); 400 stage
 * tak dikenal/body rusak; 409 transisi mundur; 404 seragam untuk token/MAC/
 * IP/job final/expired.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/boot/[name]/[token]/status">,
) {
  const { name, token } = await ctx.params
  const text = await readBodyLimited(req, 1024)
  const stage = text === null ? null : parseStageBody(text, req.headers.get("content-type"))
  const r = handleStatusCallback({ mac: name, token, stage: stage ?? "", ip: requestIp(req) })
  if (!r.ok) {
    if (r.status === 404) {
      logBootDenied("status", name.slice(0, 17), r.reason)
      return notFoundUniform()
    }
    return textResponse(r.status === 409 ? "conflict\n" : "bad request\n", r.status)
  }
  return textResponse("ok\n")
}
