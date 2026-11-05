"use client"

import { useQuery } from "@tanstack/react-query"

import { toActiveNetwork, type ActiveNetwork } from "@/hooks/use-network-config"
import type { NetworkResponse } from "@/lib/net"

/** Respons `GET /api/settings` (salinan klien `SettingsResponse` di lib/server/settings.ts). */
export type SettingsResponse = NetworkResponse & {
  interface: string
  baseUrl: string
  mediaUrl: string
  tftpRoot: string
  tokenTtlMin: number
  unknownHostAction: "local" | "wait"
}

export const SETTINGS_KEY = ["settings"] as const

async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", { cache: "no-store" })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as SettingsResponse
}

const queryOptions = {
  queryKey: SETTINGS_KEY,
  queryFn: fetchSettings,
  // Settings berasal dari env server (read-only di M4); berubah hanya saat restart.
  staleTime: 5 * 60_000,
} as const

/** Konfigurasi server non-rahasia (`GET /api/settings`, AC-4.6). */
export function useSettings() {
  return useQuery(queryOptions)
}

/**
 * Subnet management aktif dari settings server (DEC-006). Satu cache dengan `useSettings`,
 * jadi form Network, sidebar, dan halaman Settings memakai sumber yang sama.
 */
export function useActiveNetwork() {
  return useQuery({ ...queryOptions, select: selectNetwork })
}

function selectNetwork(s: SettingsResponse): ActiveNetwork {
  return toActiveNetwork(s)
}
