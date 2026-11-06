"use client"

import { useQuery } from "@tanstack/react-query"

import { apiJson } from "@/lib/api-client"

/** Respons `GET /api/auth/session` (salinan klien `SessionResponse` route). */
export type SessionInfo = { username: string; expiresAt: string }

export const SESSION_KEY = ["auth", "session"] as const

/** Sesi admin aktif (username untuk footer sidebar). 401 → alur sesi habis global. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => apiJson<SessionInfo>("/api/auth/session", { cache: "no-store" }),
    staleTime: 5 * 60_000,
  })
}

export type LogoutResult = { ok: true } | { ok: false; message: string }

/**
 * `POST /api/auth/logout` (tanpa body). 204 → keluar; 401 → sesi memang sudah habis (dianggap
 * keluar). Tidak lewat `apiFetch` agar 401 di sini tidak memicu redirect `?next=`.
 */
export async function logout(doFetch: typeof fetch = fetch): Promise<LogoutResult> {
  try {
    const res = await doFetch("/api/auth/logout", { method: "POST", cache: "no-store" })
    if (res.status === 204 || res.status === 401) return { ok: true }
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    return { ok: false, message: body?.error ?? `${res.status} ${res.statusText}` }
  } catch {
    return { ok: false, message: "Tidak bisa menghubungi server" }
  }
}
