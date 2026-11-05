"use client"

import { useQuery } from "@tanstack/react-query"

import type { OsImage } from "@/lib/os-images"

/** Item `GET /api/os-images` (salinan klien `OsImageInfo`). */
export type OsImageInfo = OsImage & {
  bootable: boolean
  available: boolean
  /** Alasan tidak tersedia (null bila tersedia). */
  reason: string | null
  builtin?: boolean
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
