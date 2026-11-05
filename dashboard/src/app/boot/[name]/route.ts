import { connection } from "next/server"

import { entryScript } from "@/lib/server/boot-script"
import { textResponse } from "@/lib/server/boot-http"
import { decideBoot, parseBootMac } from "@/lib/server/discovery"
import { requestIp } from "@/lib/server/request-ip"
import { getSettings } from "@/lib/server/settings"

/**
 * `GET /boot/entry.ipxe` → script chain ke `/boot/${mac}.ipxe?platform=…`.
 * `GET /boot/{mac}.ipxe?platform=efi|pcbios[&wait=n]` → discovery + script
 * boot (lokal / tunggu / installer). MAC invalid → 400; nama lain → 404.
 * Selalu text/plain + no-store. Token hanya muncul di script installer.
 */
export async function GET(req: Request, ctx: RouteContext<"/boot/[name]">) {
  await connection()
  const name = (await ctx.params).name
  if (name === "entry.ipxe") return textResponse(entryScript(getSettings().baseUrl))
  if (!name.endsWith(".ipxe")) return textResponse("not found\n", 404)
  const mac = parseBootMac(decodeURIComponent(name.slice(0, -".ipxe".length)))
  if (!mac) return textResponse("MAC tidak valid\n", 400)
  const url = new URL(req.url)
  const platform = url.searchParams.get("platform")
  const waitRaw = Number(url.searchParams.get("wait") ?? "0")
  const decision = decideBoot({
    mac,
    platform: platform === "efi" || platform === "pcbios" ? platform : null,
    ip: requestIp(req),
    wait: Number.isInteger(waitRaw) && waitRaw >= 0 && waitRaw <= 1000 ? waitRaw : 0,
  })
  return textResponse(decision.script)
}
