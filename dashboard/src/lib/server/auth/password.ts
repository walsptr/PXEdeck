// Hash password admin (M6-T2, DEC-017 §2): scrypt `node:crypto`, format ber-parameter
//   scrypt<$>logN<$>r<$>p<$>salt-base64<$>hash-base64      (<$> = tanda dolar)
// Parameter dibatasi (logN 14–20, r 8–16, p 1–4, salt ≥ 16 B, hash 64 B); `maxmem` eksplisit;
// perbandingan `timingSafeEqual`. Hash yang rusak/di luar batas → `verifyPassword` false tanpa
// melempar. Username tak dikenal tetap menjalankan scrypt dengan parameter yang sama (waktu setara).
//
// Implementasi setara (tanpa impor TS) ada di `scripts/admin-hash.mjs` (`npm run admin:hash`);
// paritas dua arah dibuktikan oleh test. Nilai hash TIDAK PERNAH dicatat ke log atau dikirim ke klien.
import crypto from "node:crypto"

export const SCRYPT_ID = "scrypt"
export const SCRYPT_KEYLEN = 64
export const SCRYPT_SALT_BYTES = 16
/** Parameter default helper & app: N = 2^15, r = 8, p = 1 (≈ 32 MiB). */
export const SCRYPT_DEFAULT = { logN: 15, r: 8, p: 1 } as const
export const SCRYPT_LIMITS = {
  logN: [14, 20],
  r: [8, 16],
  p: [1, 4],
} as const
/** Panjang password yang diterima helper `admin:hash`. */
export const ADMIN_PASSWORD_MIN = 12
export const ADMIN_PASSWORD_MAX = 256

export type ScryptParams = { logN: number; r: number; p: number }
export type ParsedHash = ScryptParams & { salt: Buffer; hash: Buffer }

const SEP = "$"
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/
const INT_RE = /^[1-9][0-9]{0,2}$/

/** `maxmem` scrypt untuk parameter ini: 128·N·r (+ cadangan 1 MiB). */
export function scryptMaxmem(p: ScryptParams): number {
  return 128 * 2 ** p.logN * p.r + 1024 * 1024
}

function inRange(v: number, [lo, hi]: readonly [number, number]): boolean {
  return Number.isInteger(v) && v >= lo && v <= hi
}

/** Parse hash ber-format; null bila format/parameter tidak valid (tidak pernah melempar). */
export function parsePasswordHash(encoded: string | null | undefined): ParsedHash | null {
  if (typeof encoded !== "string" || encoded.length > 512) return null
  const parts = encoded.split(SEP)
  if (parts.length !== 6 || parts[0] !== SCRYPT_ID) return null
  const [, n, r, p, salt, hash] = parts
  if (!INT_RE.test(n) || !INT_RE.test(r) || !INT_RE.test(p)) return null
  const params = { logN: Number(n), r: Number(r), p: Number(p) }
  if (
    !inRange(params.logN, SCRYPT_LIMITS.logN) ||
    !inRange(params.r, SCRYPT_LIMITS.r) ||
    !inRange(params.p, SCRYPT_LIMITS.p)
  )
    return null
  if (!B64_RE.test(salt) || !B64_RE.test(hash)) return null
  const saltBuf = Buffer.from(salt, "base64")
  const hashBuf = Buffer.from(hash, "base64")
  if (saltBuf.length < SCRYPT_SALT_BYTES || saltBuf.length > 64) return null
  if (hashBuf.length !== SCRYPT_KEYLEN) return null
  return { ...params, salt: saltBuf, hash: hashBuf }
}

/** Alasan hash tidak valid (untuk pesan start; TANPA menyebut nilai), null bila valid. */
export function passwordHashProblem(encoded: string): string | null {
  return parsePasswordHash(encoded) === null
    ? "format tidak valid (harus keluaran `npm run admin:hash`: scrypt, logN 14–20, r 8–16, p 1–4, " +
        "salt ≥ 16 B, hash 64 B, dipisah tanda dolar; di .env.local tulis setiap tanda dolar sebagai \\$)"
    : null
}

function encode(p: ScryptParams, salt: Buffer, hash: Buffer): string {
  return [SCRYPT_ID, p.logN, p.r, p.p, salt.toString("base64"), hash.toString("base64")].join(SEP)
}

function derive(password: string, salt: Buffer, p: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password.normalize("NFC"),
      salt,
      SCRYPT_KEYLEN,
      { N: 2 ** p.logN, r: p.r, p: p.p, maxmem: scryptMaxmem(p) },
      (err, key) => (err ? reject(err) : resolve(key)),
    )
  })
}

/** Hash password baru (salt acak 16 B). */
export async function hashPassword(
  password: string,
  params: ScryptParams = SCRYPT_DEFAULT,
): Promise<string> {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES)
  return encode(params, salt, await derive(password, salt, params))
}

/** Versi sinkron (helper test / skrip). */
export function hashPasswordSync(password: string, params: ScryptParams = SCRYPT_DEFAULT): string {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES)
  const key = crypto.scryptSync(password.normalize("NFC"), salt, SCRYPT_KEYLEN, {
    N: 2 ** params.logN,
    r: params.r,
    p: params.p,
    maxmem: scryptMaxmem(params),
  })
  return encode(params, salt, key)
}

/** Verifikasi password terhadap hash ber-format. Hash rusak → false (tidak melempar). */
export async function verifyPassword(password: string, encoded: string | null | undefined): Promise<boolean> {
  const parsed = parsePasswordHash(encoded)
  if (!parsed || typeof password !== "string") return false
  try {
    const key = await derive(password, parsed.salt, parsed)
    return crypto.timingSafeEqual(key, parsed.hash)
  } catch {
    return false
  }
}

/**
 * Jalankan scrypt dengan parameter `params` terhadap salt acak lalu buang hasilnya — dipakai saat
 * username tidak dikenal / admin belum dikonfigurasi agar waktu respons setara dengan verifikasi
 * sungguhan. Selalu false.
 */
export async function verifyDummy(password: string, params: ScryptParams = SCRYPT_DEFAULT): Promise<false> {
  try {
    const salt = crypto.randomBytes(SCRYPT_SALT_BYTES)
    const key = await derive(String(password), salt, params)
    crypto.timingSafeEqual(key, Buffer.alloc(SCRYPT_KEYLEN))
  } catch {
    // tetap false
  }
  return false
}

/** Perbandingan string waktu-konstan (via SHA-256 agar panjang berbeda tidak bocor). */
export function safeEqualString(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest()
  const hb = crypto.createHash("sha256").update(b, "utf8").digest()
  return crypto.timingSafeEqual(ha, hb)
}
