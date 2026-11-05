import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { connection } from "next/server"

import { loginHref, SESSION_COOKIE_NAME } from "@/lib/auth-next"
import { sessionFromId } from "@/lib/server/auth/session"

/**
 * Lapis kedua penegakan halaman (M6, DEC-017 §4): validasi sesi di DB sebelum konten dashboard
 * dirender. Tidak valid (kedaluwarsa, logout, kredensial diganti, cookie palsu) → redirect
 * `/login?next=<path>` (path dari header `x-pxe-path` yang dipasang Proxy; disanitasi).
 *
 * `await connection()` WAJIB sebelum validasi: `sessionFromId` membaca jam (`new Date()`) dan DB
 * sinkron (`node:sqlite`). Dengan Cache Components + Partial Prefetching, `cookies()` saja tidak
 * menghentikan prerender (runtime prefetch menyediakan cookie) sehingga Next memperingatkan
 * "unstable value `new Date()` while prerendering" (docs: functions/connection, functions/io).
 * `connection()` dipilih (bukan `io()`) karena keputusan autentikasi harus dibuat per request
 * pengguna nyata, tidak boleh ikut prerender/prefetch atau di-cache.
 */
export async function SessionGate({ children }: { children: React.ReactNode }) {
  const id = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  await connection()
  if (!sessionFromId(id)) {
    redirect(loginHref((await headers()).get("x-pxe-path")))
  }
  return <>{children}</>
}
