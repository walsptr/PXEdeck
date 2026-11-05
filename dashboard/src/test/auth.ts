// Helper autentikasi test (M6). Admin test memakai password ACAK per proses worker (tidak pernah
// di-commit/dicetak) dan hash scrypt yang dihitung saat runtime (tidak ada hash di repo, AC-6.53).
// Sesi dibuat SUNGGUHAN di DB lewat `createSession` dan divalidasi guard produksi tanpa jalan pintas
// (DEC-018 §3: tanpa bypass auth).
import crypto from "node:crypto"

import { hashPasswordSync } from "@/lib/server/auth/password"
import { createSession, SESSION_COOKIE } from "@/lib/server/auth/session"
import { getSettings } from "@/lib/server/settings"

export const TEST_ADMIN_USERNAME = "testadmin"
/** Password admin test: acak per worker. */
export const TEST_ADMIN_PASSWORD = `T-${crypto.randomBytes(18).toString("base64url")}`

let cachedHash: string | null = null
/** Hash scrypt `TEST_ADMIN_PASSWORD` (parameter minimum agar test cepat), dihitung sekali. */
export function testAdminHash(): string {
  cachedHash ??= hashPasswordSync(TEST_ADMIN_PASSWORD, { logN: 14, r: 8, p: 1 })
  return cachedHash
}

/** Env admin test (dipasang `isolateEnv` sebagai default). */
export function testAdminEnv(): Record<string, string> {
  return { PXE_ADMIN_USERNAME: TEST_ADMIN_USERNAME, PXE_ADMIN_PASSWORD_HASH: testAdminHash() }
}

/**
 * Buat sesi baru untuk admin aktif (env) pada `now` dan kembalikan header Cookie-nya. null bila
 * admin tidak dikonfigurasi / settings tidak valid (request lalu diuji tanpa sesi).
 */
export function sessionCookie(now: Date = new Date()): string | null {
  let admin
  try {
    admin = getSettings().admin
  } catch {
    return null
  }
  if (!admin) return null
  return `${SESSION_COOKIE}=${createSession(admin, null, now).id}`
}

/** `{ cookie }` untuk header request, atau `{}` bila tidak ada admin. */
export function authHeaders(now?: Date): Record<string, string> {
  const c = sessionCookie(now)
  return c ? { cookie: c } : {}
}
