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

/**
 * Argumen kernel installer yang memuat prefix konfigurasi
 * `${base}/boot/{mac}/{token}/` (lihat `installerScript` di boot-script.ts).
 */
export const CMDLINE_CONFIG_PARAM = {
  autoinstall: "ds=nocloud-net;s=",
  preseed: "url=",
  kickstart: "inst.ks=",
} as const
export type CmdlineMethod = keyof typeof CMDLINE_CONFIG_PARAM

export const PROC_CMDLINE = "/proc/cmdline"

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/

/**
 * Perintah sh yang mengisi variabel `u` dengan URL callback
 * `${base}/boot/{mac}/{token}/status`, diturunkan saat runtime dari argumen
 * kernel installer (B-5). Token TIDAK PERNAH ditulis ke perintah/konfigurasi
 * yang dihasilkan generator: installer (subiquity, d-i, anaconda) mencetak
 * late-command/%post ke console & log, termasuk payload base64. `u` kosong
 * bila argumen tidak ditemukan / tidak cocok pola (MAC host ini, token 43
 * karakter base64url). `cmdline` hanya untuk test.
 */
export function callbackUrlCmd(method: CmdlineMethod, mac: string, cmdline: string = PROC_CMDLINE): string {
  if (!Object.hasOwn(CMDLINE_CONFIG_PARAM, method)) throw new Error("metode tidak valid")
  if (!MAC_RE.test(mac)) throw new Error("MAC tidak valid")
  if (!PATH_RE.test(cmdline)) throw new Error(`Path tidak aman: ${cmdline}`)
  const param = CMDLINE_CONFIG_PARAM[method].replaceAll(".", "\\.")
  const sed = `s#^${param}\\(https\\{0,1\\}://.*/boot/${mac}/[A-Za-z0-9_-]\\{43\\}/\\)[^/]*$#\\1status#p`
  return `u=$(tr ' ' '\\n' < ${cmdline} | sed -n '${sed}' | head -n 1)`
}

/**
 * Perintah callback status (curl, fallback wget), tidak pernah gagal. URL
 * dari `callbackUrlCmd` (tanpa token di teks perintah).
 */
export function callbackCmd(method: CmdlineMethod, mac: string, stage: string, cmdline?: string): string {
  if (!/^[a-z]+$/.test(stage)) throw new Error("stage tidak valid")
  return `${callbackUrlCmd(method, mac, cmdline)}; curl -fsS -m 15 --retry 5 --retry-delay 3 -X POST -d stage=${stage} "$u" >/dev/null 2>&1 || wget -q -T 15 -O /dev/null --post-data=stage=${stage} "$u" || true`
}
