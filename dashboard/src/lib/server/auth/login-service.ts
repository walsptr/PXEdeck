// Login admin (M6-T2/T3, DEC-017 §1–§5). Urutan:
//  1. percobaan dicatat di rate limiter SEBELUM verifikasi (login paralel tidak bisa melewati batas);
//     terkunci → 429 tanpa verifikasi (password benar pun ditolak, tanpa membocorkan validitas);
//  2. username dibandingkan waktu-konstan; password SELALU diverifikasi scrypt — username tak dikenal
//     atau admin belum dikonfigurasi memakai `verifyDummy` dengan parameter yang sama;
//  3. sukses → hitungan (ip, username) direset, sesi lama di cookie request dihapus, sesi baru dibuat.
// Pesan gagal seragam; password/hash tidak pernah dicatat.
import { parsePasswordHash, safeEqualString, verifyDummy, verifyPassword } from "@/lib/server/auth/password"
import { beginLoginAttempt, loginSucceeded } from "@/lib/server/auth/rate-limit"
import { createSession, destroySessionId, type Session } from "@/lib/server/auth/session"
import { getSettings, type Settings } from "@/lib/server/settings"

export const LOGIN_FAILED = "Username atau password salah"
export const LOGIN_LOCKED = "Terlalu banyak percobaan login. Coba lagi nanti."

export type LoginOutcome =
  | { status: "ok"; id: string; session: Session }
  | { status: "invalid" }
  | { status: "locked"; retryAfterSec: number }

export async function login(
  input: { username: string; password: string },
  ip: string | null,
  oldSessionId: string | null,
  now: () => Date = () => new Date(),
  s: Settings = getSettings(),
): Promise<LoginOutcome> {
  const attempt = beginLoginAttempt(ip ?? "unknown", input.username, now().getTime(), s)
  if (!attempt.ok) return { status: "locked", retryAfterSec: attempt.retryAfterSec }
  const admin = s.admin
  const userOk = admin !== null && safeEqualString(input.username, admin.username)
  const pwOk =
    admin !== null && userOk
      ? await verifyPassword(input.password, admin.passwordHash)
      : await verifyDummy(input.password, parsePasswordHash(admin?.passwordHash) ?? undefined)
  if (!admin || !userOk || !pwOk) return { status: "invalid" }
  loginSucceeded(attempt)
  destroySessionId(oldSessionId)
  const { id, session } = createSession(admin, ip, now(), s)
  return { status: "ok", id, session }
}
