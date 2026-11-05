// Parsing & fingerprint public key OpenSSH. Berjalan di browser dan Node
// (keduanya punya atob + Web Crypto).

export const SSH_KEY_TYPES = [
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
] as const

export type SshKeyType = (typeof SSH_KEY_TYPES)[number]

export type ParsedSshKey = {
  type: SshKeyType
  blob: Uint8Array
  comment: string
  /** Bentuk normal: "<type> <base64> [comment]" tanpa opsi. */
  normalized: string
}

function b64decode(s: string): Uint8Array | null {
  try {
    const bin = atob(s)
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

function b64encode(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function parseSshKey(input: string): ParsedSshKey | { error: string } {
  const line = input.trim()
  if (!line) return { error: "Public key kosong" }
  if (line.includes("PRIVATE KEY")) {
    return { error: "Ini private key — tempel public key (.pub) saja" }
  }
  const parts = line.split(/\s+/)
  const type = parts[0] as SshKeyType
  if (!SSH_KEY_TYPES.includes(type)) {
    return { error: "Tipe harus ssh-ed25519, ssh-rsa, atau ecdsa-sha2-nistp*" }
  }
  if (!parts[1]) return { error: "Data key (base64) tidak ada" }
  const blob = b64decode(parts[1])
  if (!blob || blob.length < 8)
    return { error: "Data key bukan base64 yang valid" }
  // Blob diawali string tipe (uint32 panjang + teks) yang harus sama.
  const len =
    ((blob[0] << 24) | (blob[1] << 16) | (blob[2] << 8) | blob[3]) >>> 0
  const inner = new TextDecoder().decode(blob.slice(4, 4 + len))
  if (inner !== type)
    return { error: `Isi key bertipe ${inner || "?"}, bukan ${type}` }
  const comment = parts.slice(2).join(" ")
  return {
    type,
    blob,
    comment,
    normalized: [type, parts[1], comment].filter(Boolean).join(" "),
  }
}

/** Fingerprint gaya `ssh-keygen -lf`: SHA256:<base64 tanpa padding>. */
export async function sshFingerprint(blob: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", blob as BufferSource)
  return "SHA256:" + b64encode(new Uint8Array(digest)).replace(/=+$/, "")
}
