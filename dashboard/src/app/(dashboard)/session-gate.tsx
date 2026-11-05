import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { loginHref, SESSION_COOKIE_NAME } from "@/lib/auth-next"
import { sessionFromId } from "@/lib/server/auth/session"

/**
 * Lapis kedua penegakan halaman (M6, DEC-017 §4): validasi sesi di DB sebelum konten dashboard
 * dirender. Tidak valid (kedaluwarsa, logout, kredensial diganti, cookie palsu) → redirect
 * `/login?next=<path>` (path dari header `x-pxe-path` yang dipasang Proxy; disanitasi).
 */
export async function SessionGate({ children }: { children: React.ReactNode }) {
  const id = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (!sessionFromId(id)) {
    redirect(loginHref((await headers()).get("x-pxe-path")))
  }
  return <>{children}</>
}
