"use client"

import { useQuery } from "@tanstack/react-query"

import { apiJson } from "@/lib/api-client"

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
    queryFn: () =>
      apiJson<ServerStatusResponse>("/api/server-status", { cache: "no-store" }),
    refetchInterval: SERVER_STATUS_POLL_MS,
    refetchOnWindowFocus: true,
  })
}
