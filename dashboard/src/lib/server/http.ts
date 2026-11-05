import type { z } from "zod"

import { parseHostId, type ApiFieldError } from "@/lib/host-config"
import { getSettings } from "@/lib/server/settings"

// Konvensi kode status API host:
//  400 `{error}`            id di URL bukan 12 hex, body bukan JSON
//  400 `{error, errors[]}`  body melanggar skema zod
//  403 `{error}`            request mutasi lintas-origin (`guardMutation`)
//  404 `{error}`            id valid tetapi host tidak ada
//  413 `{error}`            body JSON > MAX_JSON_BODY_BYTES (`readJson`)
//  415 `{error}`            Content-Type bukan application/json (`guardMutation`)
//  422 `{error, errors[]}`  validasi semantik gagal (lihat config-service)
//
// Perlindungan request mutasi (SR-2-2, SR-3-2, SR-3-3) — sampai auth/CSRF M6:
//  - SETIAP handler POST/PATCH/DELETE memanggil `guardMutation(req, mode)`
//    sebagai langkah pertama:
//      * header Host efektif (Host; X-Forwarded-Host HANYA bila
//        PXE_TRUST_PROXY=1, CR-4-15) wajib ada di allowlist
//        `PXE_ALLOWED_HOSTS` (default: localhost, 127.0.0.1, [::1], IP PXE
//        server, host dari PXE_BASE_URL) — SR-3-5, menutup DNS rebinding
//        (Origin = Host = domain penyerang) → 403 "Host tidak diizinkan".
//        Entri tanpa port cocok dengan port apa pun; entri dengan port harus
//        persis sama.
//      * header `Origin` ada dan host-nya ≠ host request (header Host /
//        X-Forwarded-Host), `Origin: null`, atau `Sec-Fetch-Site:
//        cross-site` → 403 "Request lintas-origin ditolak".
//      * mode "json" (endpoint ber-body): Content-Type wajib
//        `application/json` (parameter charset boleh) → selain itu 415
//        "Content-Type harus application/json". Ini memaksa preflight CORS
//        sehingga form/`fetch` no-cors dari situs lain tidak bisa mengirim body.
//      * mode "none" (endpoint tanpa body: DELETE host, reboot, install
//        single): Content-Type boleh tidak ada (hook klien tidak mengirimnya);
//        bila ada, wajib `application/json` → selain itu 415. Form HTML lintas
//        situs selalu mengirim Content-Type non-JSON, jadi tertolak walau
//        browser tidak mengirim Origin.
//  - `readJson` membatasi body ke MAX_JSON_BODY_BYTES: `Content-Length` lebih
//    besar → 413 tanpa membaca body; tanpa/berbohong soal Content-Length →
//    stream dibaca dan dihentikan begitu melewati batas → 413
//    "Body melebihi batas 1 MB". Batas di atas batas zod terbesar (CSV 200 rb
//    karakter, termasuk escape JSON/UTF-8).
//  - Semua GET API mengirim `Cache-Control: no-store` (`NO_STORE`) dan memanggil
//    `guardRead(req)` (allowlist Host yang sama, DEC-015) sebagai langkah pertama.

/** Batas ukuran body JSON request (byte). */
export const MAX_JSON_BODY_BYTES = 1024 * 1024

/** Header untuk semua respons GET API (data berubah, jangan di-cache). */
export const NO_STORE = { "Cache-Control": "no-store" } as const

/** `Response.json` dengan `Cache-Control: no-store`. */
export function jsonNoStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", NO_STORE["Cache-Control"])
  return Response.json(body, { ...init, headers })
}

function errorResponse(status: number, error: string) {
  return Response.json({ error }, { status })
}

function isJsonContentType(ct: string): boolean {
  return ct.split(";")[0].trim().toLowerCase() === "application/json"
}

/**
 * Host efektif request. `X-Forwarded-Host` hanya dibaca bila proxy dipercaya
 * (`PXE_TRUST_PROXY=1`, CR-4-15/SR-4-9); tanpa itu klien bisa memalsukannya
 * untuk melewati allowlist Host.
 */
export function requestHost(req: Request, trustProxy: boolean = getSettings().trustProxy): string {
  const fwd = trustProxy
    ? req.headers.get("x-forwarded-host")?.split(",")[0].trim()
    : undefined
  return (fwd || req.headers.get("host") || new URL(req.url).host).toLowerCase()
}

/**
 * true bila `host` ("nama[:port]", huruf kecil) cocok dengan salah satu entri
 * allowlist. Entri tanpa port menerima port apa pun (fungsi murni, SR-3-5).
 */
export function isHostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.trim().toLowerCase()
  if (!h) return false
  const m = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(h)
  if (!m) return false
  const name = m[1]
  return allowed.some((a) => {
    const e = a.trim().toLowerCase()
    const em = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(e)
    if (!em) return false
    return em[2] === undefined ? em[1] === name : e === h
  })
}

/**
 * Allowlist Host untuk request baca `GET /api/**` (DEC-015, O9): Host di luar
 * `PXE_ALLOWED_HOSTS` → 403 "Host tidak diizinkan" (menutup DNS rebinding
 * terhadap data host/job sebelum login M6). Panggil sebagai langkah pertama
 * setiap handler GET API.
 */
export function guardRead(req: Request): Response | null {
  let s
  try {
    s = getSettings()
  } catch (e) {
    // Env tidak valid → 500 yang menyebut variabelnya (konvensi M4), fail-closed.
    return jsonNoStore({ error: (e as Error).message }, { status: 500 })
  }
  if (!isHostAllowed(requestHost(req, s.trustProxy), s.allowedHosts)) {
    return errorResponse(403, "Host tidak diizinkan")
  }
  return null
}

/**
 * Pemeriksaan wajib request mutasi (lihat konvensi di atas). Mengembalikan
 * Response 403/415 bila ditolak, atau null bila boleh lanjut.
 */
export function guardMutation(
  req: Request,
  body: "json" | "none",
): Response | null {
  const s = getSettings()
  const host = requestHost(req, s.trustProxy)
  if (!isHostAllowed(host, s.allowedHosts)) {
    return errorResponse(403, "Host tidak diizinkan")
  }
  const origin = req.headers.get("origin")
  if (origin !== null) {
    let originHost: string | null = null
    try {
      originHost = new URL(origin).host.toLowerCase()
    } catch {
      originHost = null // "null" atau nilai rusak
    }
    if (originHost === null || originHost !== host) {
      return errorResponse(403, "Request lintas-origin ditolak")
    }
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return errorResponse(403, "Request lintas-origin ditolak")
  }
  const ct = req.headers.get("content-type")
  if (
    body === "json"
      ? !ct || !isJsonContentType(ct)
      : ct !== null && !isJsonContentType(ct)
  ) {
    return errorResponse(415, "Content-Type harus application/json")
  }
  return null
}

const TOO_LARGE = `Body melebihi batas ${MAX_JSON_BODY_BYTES / 1024 / 1024} MB`

/** Baca body sebagai teks dengan batas byte; null bila melebihi batas. */
export async function readBodyLimited(
  req: Request,
  limit: number = MAX_JSON_BODY_BYTES,
): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) return null
  if (!req.body) return ""
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const buf = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    buf.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(buf)
}

/** Pesan 400 untuk id host yang bentuknya salah. */
export const INVALID_HOST_ID = "ID host tidak valid (harus 12 digit hex)"

export function hostNotFound() {
  return Response.json({ error: "Host tidak ditemukan" }, { status: 404 })
}

/**
 * Validasi id host dari segmen URL `[id]`. Huruf besar dinormalisasi ke kecil;
 * selain 12 hex → Response 400.
 */
export function hostIdParam(
  raw: string,
): { id: string } | { response: Response } {
  const id = parseHostId(raw)
  if (!id) {
    return {
      response: Response.json({ error: INVALID_HOST_ID }, { status: 400 }),
    }
  }
  return { id }
}

/**
 * Baca (maks. MAX_JSON_BODY_BYTES) + validasi body JSON. Mengembalikan data
 * atau Response 400/413. Tidak memeriksa Content-Type/Origin — panggil
 * `guardMutation(req, "json")` lebih dulu.
 */
export async function readJson<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  const text = await readBodyLimited(req)
  if (text === null) return { response: errorResponse(413, TOO_LARGE) }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return {
      response: Response.json(
        { error: "Body bukan JSON yang valid" },
        { status: 400 },
      ),
    }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const errors: ApiFieldError[] = parsed.error.issues.map((i) => ({
      section: String(i.path[0] ?? "hostIds") as ApiFieldError["section"],
      message: `${i.path.join(".")}: ${i.message}`,
    }))
    return {
      response: Response.json(
        { error: "Input tidak valid", errors },
        { status: 400 },
      ),
    }
  }
  return { data: parsed.data }
}

export function validationFailed(errors: ApiFieldError[]) {
  return Response.json(
    { error: errors[0]?.message ?? "Validasi gagal", errors },
    { status: 422 },
  )
}
