// Helper integration test route handler (dipanggil langsung, tanpa server HTTP).
// M6: `jsonReq`/`getReq` menyertakan cookie sesi admin SUNGGUHAN (dibuat di DB saat request
// disusun, `src/test/auth.ts`) — semua `/api/**` kini butuh sesi (DEC-017 §4). Test tanpa sesi
// memakai `anonJsonReq`/`anonGetReq` atau `new Request` langsung.
import { sessionCookie } from "./auth"

function withSession(headers: Record<string, string>): Record<string, string> {
  if (Object.keys(headers).some((k) => k.toLowerCase() === "cookie")) return headers
  const c = sessionCookie()
  return c ? { ...headers, cookie: c } : headers
}

export function ctx(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { params: Promise.resolve({ id }) } as any
}

export function jsonReq(url: string, method: string, body?: unknown, raw?: string) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: withSession({ "content-type": "application/json" }),
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
}

/** `jsonReq` TANPA cookie sesi. */
export function anonJsonReq(url: string, method: string, body?: unknown, raw?: string) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
}

/**
 * Request GET API dari Host yang diizinkan (localhost). Sejak M5 setiap handler GET `/api/**`
 * menerima `Request` untuk allowlist Host (DEC-015, `guardRead`).
 */
export function getReq(url: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, { headers: withSession(headers) })
}

/** `getReq` TANPA cookie sesi. */
export function anonGetReq(url: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, { headers })
}
