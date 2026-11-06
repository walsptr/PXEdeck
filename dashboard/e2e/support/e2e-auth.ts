// Admin E2E (M6, DEC-017 §3 / DEC-018 §3 / plan §2.10). Password ACAK per run Playwright, dibuat sekali
// di proses utama saat config dimuat lalu diwariskan ke worker lewat env proses (pola sama dengan
// `PXE_E2E_ROOT`). Hash scrypt dihitung saat runtime dan hanya dikirim ke env setiap webServer.
// Password/hash tidak pernah ditulis ke file, log, atau commit; tidak ada env bypass auth.
import { randomBytes } from "node:crypto"
import path from "node:path"

import { hashPasswordSync } from "../../src/lib/server/auth/password"

import { e2eRoot } from "./e2e-env"

/** Username admin E2E (bukan rahasia). */
export const E2E_ADMIN_USERNAME = "e2eadmin"

const PW_ENV = "E2E_ADMIN_PASSWORD"
const HASH_ENV = "E2E_ADMIN_PASSWORD_HASH"

/** Password admin run ini (acak 24 karakter base64url, dibuat sekali per run). */
export function e2eAdminPassword(): string {
  if (!process.env[PW_ENV]) {
    process.env[PW_ENV] = randomBytes(18).toString("base64url")
    // Parameter minimum yang valid (logN 14) agar login E2E cepat; batas tetap divalidasi app.
    process.env[HASH_ENV] = hashPasswordSync(process.env[PW_ENV], { logN: 14, r: 8, p: 1 })
  }
  return process.env[PW_ENV]
}

/** Env admin untuk setiap webServer E2E. */
export function e2eAdminEnv(): Record<string, string> {
  e2eAdminPassword()
  return { PXE_ADMIN_USERNAME: E2E_ADMIN_USERNAME, PXE_ADMIN_PASSWORD_HASH: process.env[HASH_ENV]! }
}

/** Path storageState sesi untuk server `name` (di `.e2e-data/run-*`, dihapus globalTeardown). */
export function storageStatePath(name: string): string {
  return path.join(e2eRoot(), "state", `${name}.json`)
}
