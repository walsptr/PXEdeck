"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { syncServerClock } from "@/hooks/use-now"
import type { Host, HostsResponse } from "@/lib/types"

export const HOSTS_KEY = ["hosts"] as const
export const HOSTS_POLL_MS = 5_000

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** Daftar host, diperbarui otomatis tiap 5 detik selama `enabled`. */
export function useHosts({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: HOSTS_KEY,
    queryFn: async () => {
      const data = await request<HostsResponse>("/api/hosts")
      syncServerClock(data.serverTime)
      return data
    },
    refetchInterval: HOSTS_POLL_MS,
    refetchIntervalInBackground: false,
    enabled,
  })
}

export function useDeleteHost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/api/hosts/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, id) => {
      qc.setQueryData<HostsResponse>(HOSTS_KEY, (old) =>
        old ? { ...old, hosts: old.hosts.filter((h) => h.id !== id) } : old,
      )
      qc.invalidateQueries({ queryKey: HOSTS_KEY })
    },
  })
}

export function useRebootHost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request<Host>(`/api/hosts/${encodeURIComponent(id)}/reboot`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: HOSTS_KEY }),
  })
}
