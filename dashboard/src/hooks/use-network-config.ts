"use client"

import { useQuery } from "@tanstack/react-query"

import {
  fromNetworkResponse,
  type MgmtNetwork,
  type NetworkResponse,
} from "@/lib/net"

/** Subnet aktif + prefix (praktis untuk tampilan dan default form). */
export type ActiveNetwork = MgmtNetwork & { prefix: number }

export const NETWORK_KEY = ["network"] as const

/** Respons `GET /api/network` → parameter subnet untuk fungsi di lib/net.ts. */
export function toActiveNetwork(r: NetworkResponse): ActiveNetwork {
  return { ...fromNetworkResponse(r), prefix: r.prefix }
}

/**
 * @deprecated M4: komponen memakai `useActiveNetwork()` dari `use-settings` (`GET /api/settings`).
 * Hook ini dipertahankan untuk kompatibilitas (kontrak `/api/network` M3 + test lama).
 *
 * Parameter subnet management yang dipakai server (CR-3-2). Form konfigurasi memvalidasi dan
 * mengisi default dari nilai ini agar UI dan API memakai aturan yang sama (DEC-006).
 */
export function useNetworkConfig() {
  return useQuery({
    queryKey: NETWORK_KEY,
    queryFn: async (): Promise<ActiveNetwork> => {
      const res = await fetch("/api/network", { cache: "no-store" })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
      }
      return toActiveNetwork((await res.json()) as NetworkResponse)
    },
    // Berubah hanya saat server di-restart dengan env lain.
    staleTime: 5 * 60_000,
  })
}
