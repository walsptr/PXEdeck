// Wrapper fetch klien bersama (M6-T8, plan §2.8 "Sesi habis"). Semua hook API dashboard memanggil
// `apiFetch` sehingga penanganan sesi & rate limit seragam:
//  - 401 dari API mana pun → klien "berhenti" (request berikutnya tidak lagi menyentuh jaringan,
//    termasuk polling dan SSE) lalu listener sesi habis dipanggil TEPAT SEKALI (Providers →
//    redirect `/login?next=<path>`). Tanpa loop toast, tanpa retry TanStack.
//  - 429 → listener rate limit (toast tunggal) dan semua request ditahan sampai `Retry-After` lewat
//    (polling mundur tanpa request jaringan selama jeda).
// Endpoint auth (`/api/auth/login`, `/api/auth/logout`) TIDAK lewat wrapper ini: 401 login berarti
// password salah, bukan sesi habis.
//
// Modul murni klien (tanpa React) — state modul berumur sepanjang halaman; navigasi ke `/login`
// memakai navigasi dokumen penuh sehingga state ini ikut tereset.
import type { ApiFieldError } from "@/lib/host-config"

/** Error API dengan status HTTP; `errors` = error per field dari server (400/422). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: ApiFieldError[] = [],
    public body?: unknown,
    /** Detik dari header `Retry-After` (429), bila ada. */
    public retryAfterSec?: number,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export const SESSION_EXPIRED_MESSAGE = "Perlu login"
export const RATE_LIMITED_MESSAGE = "Terlalu banyak request"
/** Jeda bawaan bila server membalas 429 tanpa `Retry-After` yang valid. */
export const DEFAULT_RETRY_AFTER_SEC = 5
/** Batas atas jeda yang dihormati klien (header aneh tidak membekukan dashboard berjam-jam). */
export const MAX_RETRY_AFTER_SEC = 3600

export type ApiListener = {
  /** Dipanggil sekali saat sesi terdeteksi habis (401). */
  onUnauthorized: () => void
  /** Dipanggil saat 429 diterima dari jaringan (bukan saat request ditahan lokal). */
  onRateLimited: (retryAfterSec: number) => void
}

let listener: ApiListener | null = null
let halted = false
let rateLimitedUntil = 0

/** Pasang listener global (Providers). Mengembalikan fungsi pelepas. */
export function setApiListener(l: ApiListener): () => void {
  listener = l
  return () => {
    if (listener === l) listener = null
  }
}

/** true setelah 401: semua request API ditahan sampai halaman dimuat ulang / `resetApiState`. */
export function isSessionHalted(): boolean {
  return halted
}

/** Reset state modul (setelah login sukses dan untuk test). */
export function resetApiState(): void {
  halted = false
  rateLimitedUntil = 0
}

/** Tandai sesi habis (401 atau SSE `end` reason `session`); listener dipanggil sekali saja. */
export function notifySessionExpired(): void {
  if (halted) return
  halted = true
  listener?.onUnauthorized()
}

/**
 * Detik dari header `Retry-After` (angka detik atau HTTP-date), dibulatkan ke atas, minimal 1,
 * maksimal `MAX_RETRY_AFTER_SEC`; header kosong/rusak → `DEFAULT_RETRY_AFTER_SEC`.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number {
  const v = value?.trim()
  if (!v) return DEFAULT_RETRY_AFTER_SEC
  let sec: number
  if (/^\d+(\.\d+)?$/.test(v)) sec = Number(v)
  else {
    const t = Date.parse(v)
    if (Number.isNaN(t)) return DEFAULT_RETRY_AFTER_SEC
    sec = (t - now) / 1000
  }
  return Math.min(MAX_RETRY_AFTER_SEC, Math.max(1, Math.ceil(sec)))
}

/** Sisa jeda rate limit (detik, dibulatkan ke atas) atau 0 bila tidak sedang ditahan. */
export function rateLimitRemainingSec(now: number = Date.now()): number {
  return rateLimitedUntil > now ? Math.ceil((rateLimitedUntil - now) / 1000) : 0
}

/** Tandai rate limit dari luar `apiFetch` (mis. polling log JSON dengan fetch injeksi). */
export function noteRateLimited(retryAfterSec: number, now: number = Date.now()): void {
  rateLimitedUntil = Math.max(rateLimitedUntil, now + retryAfterSec * 1000)
  listener?.onRateLimited(retryAfterSec)
}

/**
 * `fetch` untuk API dashboard. Mengembalikan Response apa adanya (pemanggil tetap membaca body),
 * kecuali saat klien ditahan: sesi habis → lempar `ApiError` 401, jeda rate limit → `ApiError`
 * 429 (keduanya tanpa request jaringan).
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (halted) throw new ApiError(SESSION_EXPIRED_MESSAGE, 401)
  const wait = rateLimitRemainingSec()
  if (wait > 0) {
    throw new ApiError(
      `${RATE_LIMITED_MESSAGE}. Coba lagi dalam ${wait} detik.`,
      429,
      [],
      undefined,
      wait,
    )
  }
  const res = await fetch(input, init)
  if (res.status === 401) notifySessionExpired()
  else if (res.status === 429) noteRateLimited(parseRetryAfter(res.headers.get("retry-after")))
  return res
}

/** Baca body JSON (null bila kosong/rusak). */
async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined
  return res.json().catch(() => undefined)
}

/**
 * Buat `ApiError` dari respons gagal: pesan = `error` server bila ada, selain itu
 * `"<status> <statusText>"`.
 */
export function errorFromResponse(res: Response, body: unknown): ApiError {
  const b = (body ?? {}) as { error?: unknown; errors?: unknown }
  const message =
    typeof b.error === "string" && b.error ? b.error : `${res.status} ${res.statusText}`
  const errors = Array.isArray(b.errors) ? (b.errors as ApiError["errors"]) : []
  return new ApiError(
    message,
    res.status,
    errors,
    body,
    res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) : undefined,
  )
}

/** `apiFetch` + parse JSON; status non-2xx → `ApiError`. 204 → undefined. */
export async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init)
  const body = await readBody(res)
  if (!res.ok) throw errorFromResponse(res, body)
  return body as T
}

/** Error yang tidak boleh di-retry otomatis oleh TanStack Query (sesi habis / rate limit). */
export function isAuthOrRateError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 429)
}

/** Kebijakan retry query bawaan: maks 1× ulang, tidak untuk 401/429. */
export function defaultQueryRetry(failureCount: number, error: unknown): boolean {
  return !isAuthOrRateError(error) && failureCount < 1
}
