// Rate limit in-memory (M6-T3, DEC-017 §5, plan §2.4). Satu proses (Next standalone di VM server);
// restart menghapus hitungan (R5). Jendela geser berbasis daftar cap waktu per kunci; jam injeksi
// (`now` ms) untuk test. Pemangkasan oportunistik (tanpa timer): paling sering 1× / 60 dtk saat
// `record`, dan saat jumlah kunci ≥ MAX_KEYS.
//
// Kunci:
//  - `login:<ip>|<username>` gagal ≤ PXE_LOGIN_MAX_FAILURES per PXE_LOGIN_WINDOW_MIN;
//  - `login-ip:<ip>` gagal ≤ 4× nilai itu per jendela yang sama;
//  - `api:<idHash sesi>` ≤ PXE_API_RATE_PER_MIN per 60 dtk.
// Percobaan login DICATAT SEBELUM verifikasi password (sinkron, sebelum `await`) sehingga login
// paralel tidak bisa melewati batas; login sukses menghapus hitungan (ip, username) dan membatalkan
// catatan percobaan itu dari hitungan per IP.
import { getSettings, type Settings } from "@/lib/server/settings"

export const MAX_KEYS = 20_000
const SWEEP_MS = 60_000

type Store = { hits: Map<string, number[]>; maxWindowMs: number; lastSweep: number }

const KEY = Symbol.for("pxe.rateLimit")
const g = globalThis as typeof globalThis & { [KEY]?: Store }

function store(): Store {
  let st = g[KEY]
  if (!st) {
    st = { hits: new Map(), maxWindowMs: 60_000, lastSweep: 0 }
    g[KEY] = st
  }
  return st
}

/** Kosongkan semua hitungan (test / restart logis). */
export function resetRateLimits(): void {
  delete g[KEY]
}

/** Buang cap waktu yang sudah keluar dari jendela terpanjang. */
export function pruneRateLimits(now: number): void {
  const st = store()
  st.lastSweep = now
  for (const [k, arr] of st.hits) {
    const keep = arr.filter((t) => now - t < st.maxWindowMs)
    if (keep.length) st.hits.set(k, keep)
    else st.hits.delete(k)
  }
}

export type Verdict = { ok: true } | { ok: false; retryAfterSec: number }

function live(key: string, now: number, windowMs: number): number[] {
  const st = store()
  st.maxWindowMs = Math.max(st.maxWindowMs, windowMs)
  const arr = st.hits.get(key)
  if (!arr) return []
  const keep = arr.filter((t) => now - t < windowMs)
  if (keep.length !== arr.length) {
    if (keep.length) st.hits.set(key, keep)
    else st.hits.delete(key)
  }
  return keep
}

/** Periksa tanpa mencatat. */
export function peek(key: string, now: number, max: number, windowMs: number): Verdict {
  const arr = live(key, now, windowMs)
  if (arr.length < max) return { ok: true }
  const oldest = arr[arr.length - max]
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) }
}

/** Catat satu kejadian. */
export function record(key: string, now: number): void {
  const st = store()
  if (now - st.lastSweep >= SWEEP_MS) pruneRateLimits(now)
  if (st.hits.size >= MAX_KEYS && !st.hits.has(key)) {
    pruneRateLimits(now)
    // Masih penuh → buang kunci tertua (urutan sisip Map) agar memori terbatas.
    if (st.hits.size >= MAX_KEYS) st.hits.delete(st.hits.keys().next().value as string)
  }
  const arr = st.hits.get(key)
  if (arr) arr.push(now)
  else st.hits.set(key, [now])
}

/** Batalkan satu catatan `at` dari kunci (login sukses tidak dihitung sebagai gagal per IP). */
export function unrecord(key: string, at: number): void {
  const arr = store().hits.get(key)
  if (!arr) return
  const i = arr.lastIndexOf(at)
  if (i >= 0) arr.splice(i, 1)
  if (!arr.length) store().hits.delete(key)
}

export function clearKey(key: string): void {
  store().hits.delete(key)
}

/** Periksa lalu catat bila diizinkan (atomik dalam satu tick event loop). */
export function take(key: string, now: number, max: number, windowMs: number): Verdict {
  const v = peek(key, now, max, windowMs)
  if (v.ok) record(key, now)
  return v
}

// ---- Login ----

/** Normalisasi username untuk kunci (bukan untuk verifikasi). */
function userKey(username: string): string {
  return username.trim().toLowerCase().slice(0, 64)
}

export type LoginAttempt =
  | { ok: true; at: number; userKey: string; ipKey: string }
  | { ok: false; retryAfterSec: number }

/**
 * Mulai percobaan login: bila (ip, username) atau ip sudah mencapai batas gagal → ditolak
 * (bahkan untuk password benar). Selain itu percobaan dicatat sebagai gagal sementara.
 */
export function beginLoginAttempt(
  ip: string,
  username: string,
  now: number,
  s: Settings = getSettings(),
): LoginAttempt {
  const windowMs = s.auth.loginWindowMin * 60_000
  const max = s.auth.loginMaxFailures
  const uk = `login:${ip}|${userKey(username)}`
  const ik = `login-ip:${ip}`
  const a = peek(uk, now, max, windowMs)
  const b = peek(ik, now, max * 4, windowMs)
  if (!a.ok || !b.ok) {
    const retry = Math.max(a.ok ? 0 : a.retryAfterSec, b.ok ? 0 : b.retryAfterSec)
    return { ok: false, retryAfterSec: retry }
  }
  record(uk, now)
  record(ik, now)
  return { ok: true, at: now, userKey: uk, ipKey: ik }
}

/** Login sukses: reset hitungan (ip, username) dan batalkan catatan percobaan ini dari per IP. */
export function loginSucceeded(a: Extract<LoginAttempt, { ok: true }>): void {
  clearKey(a.userKey)
  unrecord(a.ipKey, a.at)
}

// ---- API per sesi ----

export function takeApiRequest(sessionKey: string, now: number, s: Settings = getSettings()): Verdict {
  return take(`api:${sessionKey}`, now, s.auth.apiRatePerMin, 60_000)
}
