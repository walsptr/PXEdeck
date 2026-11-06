"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError, apiJson } from "@/lib/api-client"
import type { SshKeyInfo } from "@/lib/types"

/** Item `GET /api/ssh-keys` (M5) — satu sumber di `lib/types.ts` (CR-5-9). */
export type { SshKeyInfo }

/** Sama dengan key `useSshKeys` (tab SSH Keys di Sheet) agar library selalu sinkron. */
export const SSH_KEYS_KEY = ["ssh-keys"] as const

const api = apiJson

const JSON_HEADERS = { "content-type": "application/json" }

/** Library SSH key dengan `usedBy`. */
export function useSshKeyLibrary() {
  return useQuery({
    queryKey: SSH_KEYS_KEY,
    queryFn: () => api<SshKeyInfo[]>("/api/ssh-keys", { cache: "no-store" }),
  })
}

/** Tambah key: 201; 409 duplikat (fingerprint sama); 422 key tidak valid; 400 skema. */
export function useCreateSshKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: { name: string; publicKey: string }) =>
      api<SshKeyInfo>("/api/ssh-keys", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(p),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: SSH_KEYS_KEY }),
  })
}

/** Ubah nama key (`PATCH {name}`): 200; 400 nama invalid; 404 tidak ada. */
export function useRenameSshKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<SshKeyInfo>(`/api/ssh-keys/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name }),
      }),
    onSuccess: (key) => {
      qc.setQueryData<SshKeyInfo[]>(SSH_KEYS_KEY, (old) =>
        old?.map((k) => (k.id === key.id ? key : k)),
      )
      qc.invalidateQueries({ queryKey: SSH_KEYS_KEY })
    },
  })
}

/** Hapus key: 204; 409 bila masih dipakai host. */
export function useDeleteSshKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/ssh-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: SSH_KEYS_KEY }),
  })
}

/** Pesan error ramah dari error API (400 → pesan field pertama tanpa path zod). */
export function apiErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 400 && e.errors.length) {
    const m = e.errors[0].message
    const i = m.indexOf(": ")
    return i > 0 ? m.slice(i + 2) : m
  }
  return (e as Error)?.message ?? "Gagal"
}
