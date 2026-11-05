// Helper shell aman (O10). Nilai dinamis TIDAK pernah disisipkan mentah ke
// perintah: isi file lewat base64 (`b64write`), argumen lewat `shQuote`.

/** Quote POSIX sh: `'…'` dengan `'` → `'\''`. Menolak NUL. */
export function shQuote(s: string): string {
  if (s.includes("\0")) throw new Error("NUL tidak diizinkan")
  return `'${s.replaceAll("'", `'\\''`)}'`
}

const PATH_RE = /^\/[A-Za-z0-9._/-]+$/

export function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64")
}

/**
 * Perintah yang menulis `content` ke `path` dengan mode oktal `mode`
 * (`printf %s '<b64>' | base64 -d > path && chmod mode path`).
 */
export function b64write(path: string, mode: string, content: string): string {
  if (!PATH_RE.test(path) || path.includes("..")) throw new Error(`Path tidak aman: ${path}`)
  if (!/^0?[0-7]{3}$/.test(mode)) throw new Error(`Mode tidak valid: ${mode}`)
  return `printf %s '${b64(content)}' | base64 -d > ${path} && chmod ${mode} ${path}`
}

/** Perintah callback status (curl, fallback wget), tidak pernah gagal. */
export function callbackCmd(url: string, stage: string): string {
  if (!/^[a-z]+$/.test(stage)) throw new Error("stage tidak valid")
  const u = shQuote(url)
  return `curl -fsS -m 15 --retry 5 --retry-delay 3 -X POST -d stage=${stage} ${u} >/dev/null 2>&1 || wget -q -T 15 -O /dev/null --post-data=stage=${stage} ${u} || true`
}
