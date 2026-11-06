"use client"

import { useQuery } from "@tanstack/react-query"

import { toActiveNetwork, type ActiveNetwork } from "@/hooks/use-network-config"
import { apiJson } from "@/lib/api-client"
import type { NetworkResponse } from "@/lib/net"

/** Respons `GET /api/settings` (salinan klien `SettingsResponse` di lib/server/settings.ts). */
export type SettingsResponse = NetworkResponse & {
  interface: string
  baseUrl: string
  mediaUrl: string
  tftpRoot: string
  tokenTtlMin: number
  unknownHostAction: "local" | "wait"
  /** M5: timeout per tahap job (menit). */
  jobTimeouts: { bootingMin: number; installingMin: number; configuringMin: number }
  /** M5: batas penyajian script installer per job. */
  maxInstallerBoots: number
  /** M5: binding IP lewat lease dinonaktifkan (PXE_INSECURE_NO_LEASE_CHECK=1). */
  insecureNoLeaseCheck: boolean
  /** M6 (SR-5-4): flag insecure aktif DAN dikonfirmasi frasa `PXE_INSECURE_NO_LEASE_CHECK_CONFIRM`. */
  insecureConfirmed: boolean
  /** M6: blok "Akses" (tanpa hash password dalam bentuk apa pun). */
  auth: {
    adminUsername: string | null
    adminConfigured: boolean
    sessionIdleMin: number
    sessionMaxHours: number
    loginMaxFailures: number
    loginWindowMin: number
    apiRatePerMin: number
  }
}

export const SETTINGS_KEY = ["settings"] as const

function fetchSettings(): Promise<SettingsResponse> {
  return apiJson<SettingsResponse>("/api/settings", { cache: "no-store" })
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
