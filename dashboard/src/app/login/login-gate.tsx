import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { connection } from "next/server"

import { AdminNotConfigured } from "@/components/auth/login-card"
import { LoginForm } from "@/components/auth/login-form"
import { safeNextPath, SESSION_COOKIE_NAME } from "@/lib/auth-next"
import { sessionFromId } from "@/lib/server/auth/session"
import { getSettings } from "@/lib/server/settings"

/** Admin belum dikonfigurasi (hanya mungkin di non-production; production menolak start). */
function adminMissing(): boolean {
  try {
    return process.env.NODE_ENV !== "production" && getSettings().admin === null
  } catch {
    return false
  }
}

/**
 * Bagian dinamis halaman login: sesi masih valid → langsung ke `next` (disanitasi); selain itu form
 * login (+ instruksi bila admin belum dikonfigurasi).
 */
export async function LoginGate({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  await connection()
  const next = (await searchParams).next
  const id = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (sessionFromId(id, new Date(), false)) redirect(safeNextPath(typeof next === "string" ? next : null))
  return (
    <>
      {adminMissing() && <AdminNotConfigured />}
      <LoginForm />
    </>
  )
}
