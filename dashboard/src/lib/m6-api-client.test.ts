// M6-T8: wrapper fetch klien bersama — 401 (sesi habis, sekali, tanpa request lanjutan), 429
// (jeda `Retry-After` tanpa request jaringan), parse `Retry-After`, kebijakan retry query.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ApiError,
  apiFetch,
  apiJson,
  DEFAULT_RETRY_AFTER_SEC,
  defaultQueryRetry,
  errorFromResponse,
  isAuthOrRateError,
  isSessionHalted,
  MAX_RETRY_AFTER_SEC,
  notifySessionExpired,
  parseRetryAfter,
  rateLimitRemainingSec,
  resetApiState,
  setApiListener,
} from "./api-client"

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })

describe("api-client", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let onUnauthorized: ReturnType<typeof vi.fn<() => void>>
  let onRateLimited: ReturnType<typeof vi.fn<(sec: number) => void>>
  let off: () => void

  beforeEach(() => {
    resetApiState()
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    onUnauthorized = vi.fn<() => void>()
    onRateLimited = vi.fn<(sec: number) => void>()
    off = setApiListener({ onUnauthorized, onRateLimited })
  })
  afterEach(() => {
    off()
    resetApiState()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("2xx: Response diteruskan apa adanya; apiJson mengembalikan body; 204 → undefined", async () => {
    fetchMock.mockResolvedValueOnce(json({ a: 1 }))
    expect(await apiJson("/api/x")).toEqual({ a: 1 })
    fetchMock.mockResolvedValueOnce(json(null, 204))
    expect(await apiJson("/api/x", { method: "DELETE" })).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith("/api/x", { method: "DELETE" })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it("401: listener sesi habis TEPAT sekali; request berikutnya tidak menyentuh jaringan", async () => {
    fetchMock.mockResolvedValue(json({ error: "Perlu login" }, 401))
    await expect(apiJson("/api/hosts")).rejects.toMatchObject({ status: 401, message: "Perlu login" })
    expect(isSessionHalted()).toBe(true)
    // Polling lain yang sudah berjalan / berikutnya: ditahan lokal.
    await expect(apiFetch("/api/hosts")).rejects.toBeInstanceOf(ApiError)
    await expect(apiJson("/api/jobs")).rejects.toMatchObject({ status: 401 })
    notifySessionExpired()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    // Setelah login sukses (reset) request kembali normal.
    resetApiState()
    fetchMock.mockResolvedValueOnce(json([]))
    expect(await apiJson("/api/hosts")).toEqual([])
  })

  it("429: toast/listener sekali per respons, request ditahan sampai Retry-After lewat", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"))
    fetchMock.mockResolvedValueOnce(json({ error: "Terlalu banyak request" }, 429, { "Retry-After": "30" }))
    const e = await apiJson("/api/hosts").catch((x) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ status: 429, retryAfterSec: 30, message: "Terlalu banyak request" })
    expect(onRateLimited).toHaveBeenCalledWith(30)
    expect(rateLimitRemainingSec()).toBe(30)
    // Selama jeda: tanpa request jaringan, error 429 menyebut sisa detik.
    vi.setSystemTime(new Date("2026-11-06T10:00:10Z"))
    await expect(apiFetch("/api/hosts")).rejects.toMatchObject({ status: 429, retryAfterSec: 20 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRateLimited).toHaveBeenCalledTimes(1)
    // Jeda lewat → request lagi.
    vi.setSystemTime(new Date("2026-11-06T10:00:31Z"))
    fetchMock.mockResolvedValueOnce(json({ ok: true }))
    expect(await apiJson("/api/hosts")).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(isSessionHalted()).toBe(false)
  })

  it("parseRetryAfter: detik, HTTP-date, kosong/rusak → default, batas 1..3600", () => {
    const now = Date.parse("2026-11-06T10:00:00Z")
    expect(parseRetryAfter("120", now)).toBe(120)
    expect(parseRetryAfter(" 1.2 ", now)).toBe(2)
    expect(parseRetryAfter("0", now)).toBe(1)
    expect(parseRetryAfter("Fri, 06 Nov 2026 10:01:30 GMT", now)).toBe(90)
    expect(parseRetryAfter("Fri, 06 Nov 2026 09:00:00 GMT", now)).toBe(1)
    expect(parseRetryAfter(null, now)).toBe(DEFAULT_RETRY_AFTER_SEC)
    expect(parseRetryAfter("", now)).toBe(DEFAULT_RETRY_AFTER_SEC)
    expect(parseRetryAfter("besok", now)).toBe(DEFAULT_RETRY_AFTER_SEC)
    expect(parseRetryAfter("999999", now)).toBe(MAX_RETRY_AFTER_SEC)
  })

  it("errorFromResponse: pesan server, errors[] per field, fallback status teks", () => {
    const r = new Response("x", { status: 502, statusText: "Bad Gateway" })
    expect(errorFromResponse(r, undefined).message).toBe("502 Bad Gateway")
    const e = errorFromResponse(new Response(null, { status: 400 }), {
      error: "Validasi gagal",
      errors: [{ section: "network", message: "ip: salah" }],
    })
    expect(e).toMatchObject({ status: 400, message: "Validasi gagal" })
    expect(e.errors).toEqual([{ section: "network", message: "ip: salah" }])
    expect(errorFromResponse(new Response(null, { status: 404 }), { errors: "bukan array" }).errors).toEqual([])
  })

  it("defaultQueryRetry: 401/429 tidak diulang; error lain maks 1×", () => {
    expect(defaultQueryRetry(0, new ApiError("x", 401))).toBe(false)
    expect(defaultQueryRetry(0, new ApiError("x", 429))).toBe(false)
    expect(defaultQueryRetry(0, new ApiError("x", 500))).toBe(true)
    expect(defaultQueryRetry(1, new ApiError("x", 500))).toBe(false)
    expect(defaultQueryRetry(0, new Error("jaringan"))).toBe(true)
    expect(isAuthOrRateError(new Error("x"))).toBe(false)
  })

  it("listener dilepas → 401 tetap menahan klien tanpa melempar", async () => {
    off()
    fetchMock.mockResolvedValue(json({ error: "Perlu login" }, 401))
    await expect(apiJson("/api/hosts")).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(isSessionHalted()).toBe(true)
  })
})
