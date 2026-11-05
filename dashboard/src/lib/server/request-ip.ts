// IP sumber request (DEC-009). Next route handler tidak punya akses socket;
// nginx lokal menimpa `X-Real-IP` dengan `$remote_addr`. Header hanya
// dipercaya bila `PXE_TRUST_PROXY=1` (Next listen 127.0.0.1 di belakang
// nginx). Selain itu → null (tidak diketahui).
import { isIpv4 } from "@/lib/net"
import { getSettings } from "@/lib/server/settings"

/** Fungsi murni: IP dari header bila proxy dipercaya. */
export function ipFromHeaders(headers: Headers, trustProxy: boolean): string | null {
  if (!trustProxy) return null
  const v = headers.get("x-real-ip")?.trim() ?? ""
  return isIpv4(v) ? v : null
}

export function requestIp(req: Request): string | null {
  return ipFromHeaders(req.headers, getSettings().trustProxy)
}
