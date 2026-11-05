// Sanitizer parameter `next` halaman login (M6, plan §2.3, anti open redirect). Modul murni tanpa
// kode server — dipakai Proxy (`src/proxy.ts`), layout server, dan halaman login (klien).
//
// `next` diterima hanya bila berupa path relatif same-origin: diawali tepat satu "/" yang TIDAK
// diikuti "/" atau "\" (`//evil`, `/\evil` = URL protokol-relatif bagi browser), tanpa spasi atau
// karakter kontrol, ≤ 2048 karakter, dan bukan halaman login itu sendiri. Selain itu → `/hosts`.

export const DEFAULT_AFTER_LOGIN = "/hosts"
export const LOGIN_PATH = "/login"
const NEXT_MAX = 2048
const SAFE_NEXT_RE = /^\/(?![/\\])[^\s\x00-\x1f\x7f]*$/

/** Path tujuan setelah login yang aman, atau `/hosts`. */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length > NEXT_MAX || !SAFE_NEXT_RE.test(raw)) return DEFAULT_AFTER_LOGIN
  const pathOnly = raw.split(/[?#]/, 1)[0]
  if (pathOnly === LOGIN_PATH || pathOnly.startsWith(`${LOGIN_PATH}/`)) return DEFAULT_AFTER_LOGIN
  return raw
}

/** URL halaman login dengan `next` (path+query yang disanitasi). */
export function loginHref(next: string | null | undefined): string {
  return `${LOGIN_PATH}?next=${encodeURIComponent(safeNextPath(next))}`
}

/** Bentuk id sesi di cookie `pxe_session` (32 B base64url) — pemeriksaan optimistis Proxy. */
export const SESSION_COOKIE_NAME = "pxe_session"
export const SESSION_COOKIE_RE = /^[A-Za-z0-9_-]{43}$/

/** Path yang tidak butuh sesi di Proxy (API & /boot ditegakkan di handler masing-masing). */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === LOGIN_PATH ||
    pathname.startsWith(`${LOGIN_PATH}/`) ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/boot" ||
    pathname.startsWith("/boot/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    /\.(?:ico|png|svg|jpg|jpeg|webp|gif|woff2?|ttf|otf|txt|xml|webmanifest)$/i.test(pathname)
  )
}

/**
 * Keputusan Proxy (fungsi murni): halaman terproteksi tanpa cookie sesi berbentuk valid → URL
 * redirect `/login?next=<path+query>`; selain itu null (lanjut). Validasi sesi sesungguhnya (DB)
 * ada di layout server `(dashboard)` dan di setiap handler API (`requireSession`).
 */
export function proxyRedirect(pathname: string, search: string, cookie: string | undefined): string | null {
  if (isPublicPath(pathname)) return null
  if (cookie !== undefined && SESSION_COOKIE_RE.test(cookie)) return null
  return loginHref(`${pathname}${search}`)
}
