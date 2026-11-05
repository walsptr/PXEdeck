// Sesi admin server-side (M6-T2, DEC-017 §1, plan §2.3).
//  - id sesi = 32 byte acak base64url (43 karakter), hanya di cookie `pxe_session`; DB menyimpan
//    sha256 hex-nya (`sessions.id_hash`).
//  - Valid bila: format benar, baris ada, username = admin aktif, `cred_fp` = sidik kredensial aktif
//    (ganti hash/username → semua sesi lama batal), `now < expires_at` (absolut
//    `PXE_SESSION_MAX_HOURS`), dan `now − last_seen_at ≤ PXE_SESSION_IDLE_MIN` (geser).
//  - Perpanjangan idle: `last_seen_at` ditulis paling sering 1× per `TOUCH_INTERVAL_MS`.
//  - Sesi tidak valid yang ditemukan saat validasi dihapus; sisanya oleh `pruneSessions` (watchdog).
// Semua fungsi menerima `now` (jam injeksi untuk test).
import crypto from "node:crypto"

import { getDb } from "@/lib/server/db"
import {
  deleteExpiredSessions,
  deleteSession,
  getSessionRow,
  insertSession,
  touchSession,
} from "@/lib/server/db/repos/sessions"
import { getSettings, type AdminCredential, type Settings } from "@/lib/server/settings"

export const SESSION_COOKIE = "pxe_session"
/** Bentuk id sesi mentah di cookie (32 B base64url tanpa padding). */
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{43}$/
/** Interval minimum tulis `last_seen_at` (ms). */
export const TOUCH_INTERVAL_MS = 60_000

export type Session = {
  /** sha256(id sesi) — kunci internal (rate limit, batas SSE); bukan nilai cookie. */
  idHash: string
  username: string
  createdAt: string
  expiresAt: string
}

export function hashSessionId(id: string): string {
  return crypto.createHash("sha256").update(id, "utf8").digest("hex")
}

/** Sidik kredensial admin (16 hex): ganti username/hash → sesi lama tidak valid. */
export function credFingerprint(admin: AdminCredential): string {
  return crypto
    .createHash("sha256")
    .update(`${admin.username}\n${admin.passwordHash}`, "utf8")
    .digest("hex")
    .slice(0, 16)
}

/** Buat sesi baru untuk admin aktif. Mengembalikan id mentah (untuk cookie) + data sesi. */
export function createSession(
  admin: AdminCredential,
  ip: string | null,
  now: Date = new Date(),
  s: Settings = getSettings(),
): { id: string; session: Session } {
  const id = crypto.randomBytes(32).toString("base64url")
  const idHash = hashSessionId(id)
  const at = now.toISOString()
  const expiresAt = new Date(now.getTime() + s.auth.sessionMaxHours * 3_600_000).toISOString()
  getDb()
  insertSession({
    idHash,
    username: admin.username,
    credFp: credFingerprint(admin),
    createdAt: at,
    lastSeenAt: at,
    expiresAt,
    ip,
  })
  return { id, session: { idHash, username: admin.username, createdAt: at, expiresAt } }
}

/**
 * Validasi sesi berdasarkan id hash. `touch` = perpanjang idle (maks 1 tulis / 60 dtk).
 * Sesi tidak valid dihapus. null bila tidak valid.
 */
export function sessionByHash(
  idHash: string,
  now: Date = new Date(),
  touch = true,
  s: Settings = getSettings(),
): Session | null {
  if (!s.admin) return null
  getDb()
  const row = getSessionRow(idHash)
  if (!row) return null
  const t = now.getTime()
  const idleMs = s.auth.sessionIdleMin * 60_000
  const lastSeen = Date.parse(row.lastSeenAt)
  const valid =
    row.username === s.admin.username &&
    row.credFp === credFingerprint(s.admin) &&
    t < Date.parse(row.expiresAt) &&
    t - lastSeen <= idleMs
  if (!valid) {
    deleteSession(idHash)
    return null
  }
  if (touch && t - lastSeen >= TOUCH_INTERVAL_MS) touchSession(idHash, now.toISOString())
  return { idHash, username: row.username, createdAt: row.createdAt, expiresAt: row.expiresAt }
}

/** Validasi id sesi mentah dari cookie (format dulu, tanpa query DB bila format salah). */
export function sessionFromId(
  id: string | null | undefined,
  now: Date = new Date(),
  touch = true,
): Session | null {
  if (typeof id !== "string" || !SESSION_ID_RE.test(id)) return null
  return sessionByHash(hashSessionId(id), now, touch)
}

/** Hapus sesi dari id mentah (logout / login ulang). Format salah → no-op. */
export function destroySessionId(id: string | null | undefined): void {
  if (typeof id !== "string" || !SESSION_ID_RE.test(id)) return
  getDb()
  deleteSession(hashSessionId(id))
}

/** Hapus sesi kedaluwarsa/idle/kredensial lama (idempoten). Mengembalikan jumlah dihapus. */
export function pruneSessions(now: Date = new Date(), s: Settings = getSettings()): number {
  getDb()
  const idleBefore = new Date(now.getTime() - s.auth.sessionIdleMin * 60_000).toISOString()
  return deleteExpiredSessions(now.toISOString(), idleBefore, s.admin ? credFingerprint(s.admin) : null)
}

/** Nilai cookie bernama `name` dari header Cookie (nilai pertama). */
export function readCookie(header: string | null, name: string = SESSION_COOKIE): string | null {
  if (!header) return null
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    return part.slice(eq + 1).trim()
  }
  return null
}

function secureFlag(s: Settings): string {
  return s.baseUrl.startsWith("https://") ? "; Secure" : ""
}

/** Header `Set-Cookie` sesi baru: HttpOnly, SameSite=Strict, Path=/, Max-Age umur absolut. */
export function sessionCookieHeader(id: string, s: Settings = getSettings()): string {
  const maxAge = s.auth.sessionMaxHours * 3600
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureFlag(s)}`
}

/** Header `Set-Cookie` penghapus cookie sesi (`Max-Age=0`). */
export function clearSessionCookieHeader(s: Settings = getSettings()): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag(s)}`
}
