"use client"

import { useQuery } from "@tanstack/react-query"

export type ServiceState = "online" | "offline" | "unknown"

/** Respons `GET /api/server-status` (salinan klien `ServerStatusResponse`). */
export type ServerStatusResponse = {
  services: {
    name: "DHCP" | "TFTP" | "HTTP"
    state: ServiceState
    online: boolean
    detail: string
  }[]
  checkedAt: string
}

export const SERVER_STATUS_KEY = ["server-status"] as const
export const SERVER_STATUS_POLL_MS = 15_000

/** Status DHCP/TFTP/HTTP nyata untuk top bar; di-poll selama tab terlihat. */
export function useServerStatus() {
  return useQuery({
    queryKey: SERVER_STATUS_KEY,
    queryFn: async (): Promise<ServerStatusResponse> => {
      const res = await fetch("/api/server-status", { cache: "no-store" })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
      }
      return (await res.json()) as ServerStatusResponse
    },
    refetchInterval: SERVER_STATUS_POLL_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  })
}
