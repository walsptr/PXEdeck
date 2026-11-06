// Public key SSH SINTETIS untuk uji batas ukuran (CR-6-1, M6 iter2). Blob = string tipe OpenSSH
// (`uint32 len + "ssh-rsa"`) + byte deterministik (PRNG ber-seed) — lolos `parseSshKey`/`sanitizeKey`,
// fingerprint berbeda per seed. Bukan key sungguhan (tidak ada private key); bukan kode produk.

/** Key `ssh-rsa <base64> <komentar>` dengan panjang string TEPAT `len` (≥ 40). */
export function synthKey(seed: number, len: number, comment = "synth"): string {
  const prefix = "ssh-rsa "
  // Data base64 kelipatan 4 tanpa padding; sisa diisi komentar (≤ 64, sesuai sanitizeKey).
  const room = len - prefix.length - 1 - comment.length
  const dataLen = room - (room % 4)
  const pad = room - dataLen
  const blobLen = (dataLen / 4) * 3
  const type = new TextEncoder().encode("ssh-rsa")
  const blob = new Uint8Array(blobLen)
  blob.set([0, 0, 0, type.length], 0)
  blob.set(type, 4)
  let x = (seed * 2654435761) >>> 0 || 1
  for (let i = 4 + type.length; i < blobLen; i++) {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    blob[i] = x & 0xff
  }
  const data = Buffer.from(blob).toString("base64")
  const key = `${prefix}${data} ${comment}${"x".repeat(pad)}`
  if (key.length !== len) throw new Error(`synthKey: panjang ${key.length} ≠ ${len}`)
  return key
}

/** Daftar key sintetis dengan total `authorizedKeysBytes` (panjang + newline) TEPAT `total`. */
export function synthKeysTotal(total: number, perKey = 16_000): string[] {
  const out: string[] = []
  let left = total
  let seed = 1
  while (left > 0) {
    // Setiap key memakan len + 1 byte; sisa < 41 tidak cukup untuk satu key → gabungkan ke key terakhir.
    let len = Math.min(perKey, left - 1)
    if (left - (len + 1) > 0 && left - (len + 1) < 41) len = left - 1 - 41
    out.push(synthKey(seed++, len))
    left -= len + 1
  }
  return out
}
