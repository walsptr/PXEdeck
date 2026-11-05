// M6-T3 (backend-dev): rate limit in-memory (jendela geser, jam injeksi).
import { describe, expect, it } from "vitest"

import { getSettings } from "@/lib/server/settings"
import { isolateEnv } from "@/test/env"

import {
  beginLoginAttempt,
  clearKey,
  loginSucceeded,
  MAX_KEYS,
  peek,
  pruneRateLimits,
  record,
  take,
  takeApiRequest,
  unrecord,
} from "./rate-limit"

isolateEnv()

const T = 1_800_000_000_000

describe("jendela geser", () => {
  it("take: max per jendela, Retry-After = sisa umur kejadian tertua yang relevan (dibulatkan ke atas)", () => {
    for (let i = 0; i < 3; i++) expect(take("k", T + i * 1000, 3, 10_000)).toEqual({ ok: true })
    expect(take("k", T + 3000, 3, 10_000)).toEqual({ ok: false, retryAfterSec: 7 })
    // Penolakan tidak dicatat (tidak memperpanjang hukuman).
    expect(take("k", T + 9999, 3, 10_000)).toEqual({ ok: false, retryAfterSec: 1 })
    expect(take("k", T + 10_000, 3, 10_000)).toEqual({ ok: true })
    expect(take("k", T + 10_500, 3, 10_000)).toEqual({ ok: false, retryAfterSec: 1 })
  })

  it("kunci terpisah tidak saling memengaruhi; clearKey/unrecord", () => {
    record("a", T)
    record("a", T)
    expect(peek("a", T, 2, 1000).ok).toBe(false)
    expect(peek("b", T, 2, 1000).ok).toBe(true)
    unrecord("a", T)
    expect(peek("a", T, 2, 1000).ok).toBe(true)
    unrecord("a", T)
    unrecord("a", T) // kosong → no-op
    unrecord("tidak-ada", T)
    record("a", T)
    record("a", T)
    clearKey("a")
    expect(peek("a", T, 2, 1000).ok).toBe(true)
  })

  it("prune membuang kunci basi; jumlah kunci dibatasi MAX_KEYS (memori terbatas)", () => {
    for (let i = 0; i < MAX_KEYS; i++) record(`k${i}`, T)
    record("baru", T + 1)
    // Kunci tertua dibuang agar total tetap ≤ MAX_KEYS.
    expect(peek("k0", T + 1, 1, 60_000).ok).toBe(true)
    expect(peek("baru", T + 1, 1, 60_000).ok).toBe(false)
    pruneRateLimits(T + 120_000)
    expect(peek("baru", T + 120_000, 1, 60_000).ok).toBe(true)
  })

  it("record memangkas oportunistik setelah 60 dtk", () => {
    record("x", T)
    record("y", T + 61_000)
    expect(peek("x", T + 61_000, 1, 60_000).ok).toBe(true)
  })
})

describe("login (DEC-017 §5)", () => {
  it("5 gagal per (IP, username) → ke-6 ditolak; username lain dari IP sama masih boleh sampai 20 per IP", () => {
    const s = getSettings()
    for (let i = 0; i < 5; i++) expect(beginLoginAttempt("10.0.0.9", "admin", T + i, s).ok).toBe(true)
    const locked = beginLoginAttempt("10.0.0.9", "ADMIN ", T + 10, s)
    expect(locked).toEqual({ ok: false, retryAfterSec: 900 })
    let n = 5
    for (let u = 0; n < 20; u++) {
      for (let i = 0; i < 4 && n < 20; i++, n++) expect(beginLoginAttempt("10.0.0.9", `user${u}`, T + 100 + n, s).ok).toBe(true)
    }
    expect(beginLoginAttempt("10.0.0.9", "fresh", T + 200, s).ok).toBe(false)
    // IP lain tidak terdampak.
    expect(beginLoginAttempt("10.0.0.10", "admin", T + 200, s).ok).toBe(true)
    // Setelah jendela 15 mnt lewat → boleh lagi.
    expect(beginLoginAttempt("10.0.0.9", "admin", T + 15 * 60_000 + 200, s).ok).toBe(true)
  })

  it("login sukses mereset (IP, username) dan tidak dihitung gagal per IP", () => {
    const s = getSettings()
    for (let i = 0; i < 4; i++) beginLoginAttempt("10.0.0.9", "admin", T + i, s)
    const ok = beginLoginAttempt("10.0.0.9", "admin", T + 10, s)
    expect(ok.ok).toBe(true)
    if (ok.ok) loginSucceeded(ok)
    for (let i = 0; i < 5; i++) expect(beginLoginAttempt("10.0.0.9", "admin", T + 20 + i, s).ok).toBe(true)
    // per IP: 4 gagal awal + 5 baru = 9 (sukses tidak dihitung) → 11 lagi boleh, ke-12 tidak.
    for (let i = 0; i < 11; i++) expect(beginLoginAttempt("10.0.0.9", `u${i}`, T + 40 + i, s).ok).toBe(true)
    expect(beginLoginAttempt("10.0.0.9", "z", T + 60, s).ok).toBe(false)
  })

  it("PXE_LOGIN_MAX_FAILURES / PXE_LOGIN_WINDOW_MIN dari env", () => {
    process.env.PXE_LOGIN_MAX_FAILURES = "3"
    process.env.PXE_LOGIN_WINDOW_MIN = "1"
    const s = getSettings()
    for (let i = 0; i < 3; i++) beginLoginAttempt("ip", "a", T, s)
    expect(beginLoginAttempt("ip", "a", T + 1000, s)).toEqual({ ok: false, retryAfterSec: 59 })
    expect(beginLoginAttempt("ip", "a", T + 60_000, s).ok).toBe(true)
  })
})

describe("API per sesi", () => {
  it("PXE_API_RATE_PER_MIN per sesi per 60 dtk; sesi lain terpisah", () => {
    process.env.PXE_API_RATE_PER_MIN = "60"
    const s = getSettings()
    for (let i = 0; i < 60; i++) expect(takeApiRequest("s1", T + i, s).ok).toBe(true)
    expect(takeApiRequest("s1", T + 100, s)).toEqual({ ok: false, retryAfterSec: 60 })
    expect(takeApiRequest("s2", T + 100, s).ok).toBe(true)
    expect(takeApiRequest("s1", T + 60_000, s).ok).toBe(true)
  })
})
