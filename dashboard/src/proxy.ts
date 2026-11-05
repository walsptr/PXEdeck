// Proxy Next 16 (pengganti middleware, runtime Node.js) — M6, DEC-017 §4, plan §2.3.
// Lapis pertama untuk HALAMAN: tanpa cookie `pxe_session` berbentuk valid → 307 ke
// `/login?next=<path+query>` (sanitasi anti open redirect, `lib/auth-next.ts`). Pemeriksaan
// optimistis saja (tanpa DB, sesuai panduan autentikasi Next); validasi sesi sesungguhnya ada di
// layout server `(dashboard)` (lapis kedua) dan di setiap handler API (`requireSession`, sumber
// kebenaran). `/api/**`, `/boot/**`, `/login`, dan aset statis tidak diproses di sini.
// Path asli diteruskan ke layout lewat header request `x-pxe-path` (untuk `next` saat sesi ditolak).
import { NextResponse, type NextRequest } from "next/server"

import { proxyRedirect, SESSION_COOKIE_NAME } from "@/lib/auth-next"

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const target = proxyRedirect(pathname, search, req.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (target) return NextResponse.redirect(new URL(target, req.url), 307)
  const headers = new Headers(req.headers)
  headers.set("x-pxe-path", `${pathname}${search}`)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: [
    "/((?!api/|api$|boot/|boot$|_next/static|_next/image|favicon\\.ico|login$|login/).*)",
  ],
}
