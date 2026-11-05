"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/hooks/use-host-config"

import { canonicalOsImageId, osLabel, type OsImage } from "@/lib/os-images"

/** Item `GET /api/os-images` (salinan klien `OsImageInfo`). */
export type OsImageInfo = OsImage & {
  bootable: boolean
  available: boolean
  /** Alasan tidak tersedia (null bila tersedia). */
  reason: string | null
  builtin?: boolean
  // Field M5 selalu dikirim `GET /api/os-images`; opsional di tipe klien agar data parsial
  // (cache lama / fixture M4) tetap aman dirender.
  /** M5: path media relatif `PXE_MEDIA_ROOT`. */
  source?: { kernel: string; initrd: string; repo: string }
  /** M5: `${PXE_MEDIA_URL}/${source.repo}`. */
  repoUrl?: string
  /** M5: jumlah host yang mereferensikan image. */
  usedBy?: number
  createdAt?: string
}

/** Body `POST /api/os-images` (salinan klien `newOsImagePayload`, DEC-015: path lokal saja). */
export type NewOsImagePayload = {
  id: string
  name: string
  version: string
  arch: "amd64" | "arm64"
  method: OsImage["method"]
  bootable: boolean
  source: { kernel: string; initrd: string; repo: string }
}

export const OS_IMAGES_KEY = ["os-images"] as const

/** Katalog OS image + ketersediaan media di server. */
export function useOsImages() {
  return useQuery({
    queryKey: OS_IMAGES_KEY,
    queryFn: async (): Promise<OsImageInfo[]> => {
      const res = await fetch("/api/os-images", { cache: "no-store" })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
      }
      return (await res.json()) as OsImageInfo[]
    },
    staleTime: 30_000,
  })
}

/** Alasan image tidak bisa di-install lewat dashboard (null bila bisa). */
export function installBlockReason(img: OsImageInfo | undefined): string | null {
  if (!img) return null
  if (!img.available) return img.reason ?? "Media tidak tersedia di server"
  if (img.method === "unattend")
    return "Windows: hanya generator unattend.xml — install lewat dashboard ditolak"
  if (!img.bootable) return "Image tidak bisa di-boot lewat PXE"
  return null
}

/**
 * Label OS image ("Ubuntu Server 24.04.5 LTS") dari katalog server (termasuk image yang
 * didaftarkan operator); fallback ke katalog bawaan / id.
 */
export function useOsLabel(): (id: string | null | undefined) => string | null {
  const { data } = useOsImages()
  return (id) => {
    if (!id) return null
    const img = data?.find((i) => i.id === canonicalOsImageId(id))
    return img ? `${img.name} ${img.version}` : osLabel(id)
  }
}

async function mutate<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body =
    res.status === 204 ? undefined : await res.json().catch(() => undefined)
  if (!res.ok)
    throw new ApiError(
      body?.error ?? `${res.status} ${res.statusText}`,
      res.status,
      body?.errors ?? [],
      body,
    )
  return body as T
}

/** Daftarkan OS image (201) — 400 per field (`errors[]`), 409 id sudah ada. */
export function useCreateOsImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: NewOsImagePayload) =>
      mutate<OsImageInfo>("/api/os-images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: OS_IMAGES_KEY }),
  })
}

/** Hapus OS image (204) — 409 bila masih dipakai host/job. */
export function useDeleteOsImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      mutate<void>(`/api/os-images/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: OS_IMAGES_KEY }),
  })
}

/** Field form registrasi image yang bisa menerima error server. */
export const OS_IMAGE_FIELDS = [
  "id",
  "name",
  "version",
  "arch",
  "method",
  "bootable",
  "source.kernel",
  "source.initrd",
  "source.repo",
  "source",
] as const
export type OsImageField = (typeof OS_IMAGE_FIELDS)[number]

/**
 * Petakan error server ke field form: 400 `errors[].message` berawalan path zod
 * (`"source.kernel: …"`), 409 → `id`. Error tanpa field → `form`.
 */
export function osImageFieldErrors(
  e: unknown,
): Partial<Record<OsImageField | "form", string[]>> {
  const out: Partial<Record<OsImageField | "form", string[]>> = {}
  const add = (k: OsImageField | "form", m: string) => (out[k] ??= []).push(m)
  if (!(e instanceof ApiError)) {
    add("form", (e as Error)?.message ?? "Gagal")
    return out
  }
  if (e.status === 409) {
    add("id", e.message)
    return out
  }
  for (const fe of e.errors) {
    const i = fe.message.indexOf(": ")
    const path = i > 0 ? fe.message.slice(0, i) : ""
    const msg = i > 0 ? fe.message.slice(i + 2) : fe.message
    if ((OS_IMAGE_FIELDS as readonly string[]).includes(path))
      add(path as OsImageField, localizeValidationMessage(msg))
    else add("form", fe.message)
  }
  if (!e.errors.length) add("form", e.message)
  return out
}

/**
 * DR-5-5: pesan bawaan zod (bahasa Inggris, mis. `"Too small: expected string to have >=1
 * characters"`) diterjemahkan ke bahasa Indonesia. Pesan kustom server (sudah berbahasa
 * Indonesia) dikembalikan apa adanya.
 */
export function localizeValidationMessage(msg: string): string {
  let m: RegExpExecArray | null
  if ((m = /^Too small: expected string to have >=(\d+) characters?$/.exec(msg)))
    return m[1] === "1" ? "Wajib diisi" : `Minimal ${m[1]} karakter`
  if ((m = /^Too big: expected string to have <=(\d+) characters?$/.exec(msg)))
    return `Maksimal ${m[1]} karakter`
  if (/^Invalid option\b/.test(msg)) return "Pilihan tidak valid"
  if (/^Invalid input: expected \w+, received undefined$/.test(msg)) return "Wajib diisi"
  if (/^Invalid (input|string|format)\b/.test(msg)) return "Nilai tidak valid"
  return msg
}
