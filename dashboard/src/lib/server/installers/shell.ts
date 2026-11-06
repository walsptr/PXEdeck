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

const LOG_MESSAGE_RE = /^[A-Za-z0-9 :.,_()/-]{1,200}$/

/**
 * Perintah sh yang mengisi variabel `b` dengan basis URL per job `${base}/boot/{mac}/{token}/`
 * (diakhiri "/"), diturunkan saat runtime dari argumen kernel installer — pola sama dengan
 * `callbackUrlCmd` (MAC host ini + token 43 karakter), B-5. `b` kosong bila tidak cocok.
 */
export function callbackBaseCmd(method: CmdlineMethod, mac: string, cmdline: string = PROC_CMDLINE): string {
  if (!Object.hasOwn(CMDLINE_CONFIG_PARAM, method)) throw new Error("metode tidak valid")
  if (!MAC_RE.test(mac)) throw new Error("MAC tidak valid")
  if (!PATH_RE.test(cmdline)) throw new Error(`Path tidak aman: ${cmdline}`)
  const param = CMDLINE_CONFIG_PARAM[method].replaceAll(".", "\\.")
  const sed = `s#^${param}\\(https\\{0,1\\}://.*/boot/${mac}/[A-Za-z0-9_-]\\{43\\}/\\)[^/]*$#\\1#p`
  return `b=$(tr ' ' '\\n' < ${cmdline} | sed -n '${sed}' | head -n 1)`
}

/**
 * Kirim satu baris log KONSTAN ke `${b}log` (M5, plan §2.5). `message` hanya konstanta generator
 * (tanpa nilai pengguna; divalidasi). `b` kosong → no-op; tidak pernah gagal (`|| true`). Token tidak
 * pernah tertulis di perintah (URL dari /proc/cmdline).
 */
export function logCmd(method: CmdlineMethod, mac: string, message: string, cmdline?: string): string {
  if (!LOG_MESSAGE_RE.test(message)) throw new Error("pesan log tidak valid")
  const q = shQuote(message)
  return `${callbackBaseCmd(method, mac, cmdline)}; if [ -n "$b" ]; then printf '%s\\n' ${q} | curl -fsS -m 15 --data-binary @- -H 'Content-Type: text/plain' "\${b}log" >/dev/null 2>&1 || wget -q -T 15 -O /dev/null --header='Content-Type: text/plain' --post-data=${q} "\${b}log" >/dev/null 2>&1 || true; fi`
}

/** Baris & lebar maksimum tail per file (≤ batas endpoint 200 baris / 16 KB per request). */
export const LOG_TAIL_LINES = 60
export const LOG_TAIL_WIDTH = 240

/**
 * Kirim tail file log installer yang ada (`[ -f ]`) ke `${b}log`, satu request per file, diawali
 * baris `ERROR installer gagal: <file>` (level error di server). Hanya dipakai di jalur gagal
 * (error-commands / %onerror); isi diredaksi server. Tidak pernah gagal.
 */
export function logTailCmd(method: CmdlineMethod, mac: string, files: string[], cmdline?: string): string {
  for (const f of files) if (!PATH_RE.test(f) || f.includes("..")) throw new Error(`Path tidak aman: ${f}`)
  return `${callbackBaseCmd(method, mac, cmdline)}; if [ -n "$b" ]; then for f in ${files.join(" ")}; do [ -f "$f" ] && { printf 'ERROR installer gagal: %s\\n' "$f"; tail -n ${LOG_TAIL_LINES} "$f" | cut -c1-${LOG_TAIL_WIDTH}; } | curl -fsS -m 15 --data-binary @- -H 'Content-Type: text/plain' "\${b}log" >/dev/null 2>&1; done; fi; true`
}

/**
 * Kirim isi `file` (hasil perintah diagnosis generator, mis. daftar disk/modul — bukan nilai pengguna
 * dan tanpa token) ke `${b}log` sebagai satu request. curl bila ada, fallback busybox wget
 * `--post-data` (d-i tidak punya curl). Isi dipotong 200 baris × 240 kolom (batas endpoint). Tidak
 * pernah gagal. Jalur gagal saja (M6 BUG-M6-8).
 */
export function logFileCmd(method: CmdlineMethod, mac: string, file: string, cmdline?: string): string {
  if (!PATH_RE.test(file) || file.includes("..")) throw new Error(`Path tidak aman: ${file}`)
  return `${callbackBaseCmd(method, mac, cmdline)}; if [ -n "$b" ] && [ -f ${file} ]; then head -n 200 ${file} | cut -c1-${LOG_TAIL_WIDTH} > ${file}.cut; curl -fsS -m 15 --data-binary @${file}.cut -H 'Content-Type: text/plain' "\${b}log" >/dev/null 2>&1 || wget -q -T 15 -O /dev/null --header='Content-Type: text/plain' --post-data="$(cat ${file}.cut)" "\${b}log" >/dev/null 2>&1 || true; fi; true`
}
