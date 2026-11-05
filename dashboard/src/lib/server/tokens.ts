// Token per job (DEC-008): 32 byte acak, base64url (43 karakter). DB hanya
// menyimpan sha256(token) (hex). Token TIDAK PERNAH di-log maupun
// dikembalikan API; plaintext hanya ada di script iPXE untuk host itu.
import { createHash, randomBytes } from "node:crypto"

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, hash: hashToken(token) }
}

export function isTokenShape(s: string): boolean {
  return TOKEN_RE.test(s)
}
