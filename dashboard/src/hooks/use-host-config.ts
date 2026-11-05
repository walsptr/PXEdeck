"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { HOSTS_KEY } from "@/hooks/use-hosts"
import type {
  ApiFieldError,
  ConfigPayload,
  CsvRowResult,
  InstallResult,
  PublicHostConfig,
  SaveResult,
  SshKey,
} from "@/lib/host-config"

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: ApiFieldError[] = [],
    public body?: unknown,
  ) {
    super(message)
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  })
  const body =
    res.status === 204 ? undefined : await res.json().catch(() => undefined)
  if (!res.ok) {
    throw new ApiError(
      body?.error ?? `${res.status} ${res.statusText}`,
      res.status,
      body?.errors ?? [],
      body,
    )
  }
  return body as T
}

export const configKey = (id: string) => ["host-config", id] as const

export function useHostConfig(id: string | null) {
  return useQuery({
    queryKey: configKey(id ?? ""),
    queryFn: () => api<PublicHostConfig>(`/api/hosts/${id}/config`),
    enabled: Boolean(id),
    staleTime: 0,
  })
}

export function useSshKeys() {
  return useQuery({
    queryKey: ["ssh-keys"],
    queryFn: () => api<SshKey[]>("/api/ssh-keys"),
  })
}

export function useSaveConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      hostIds,
      payload,
    }: {
      hostIds: string[]
      payload: ConfigPayload
    }) =>
      hostIds.length === 1
        ? api<SaveResult>(`/api/hosts/${hostIds[0]}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : api<SaveResult>("/api/hosts/bulk", {
            method: "POST",
            body: JSON.stringify({ hostIds, ...payload }),
          }),
    onSuccess: (_r, { hostIds }) => {
      qc.invalidateQueries({ queryKey: HOSTS_KEY })
      qc.invalidateQueries({ queryKey: ["ssh-keys"] })
      for (const id of hostIds)
        qc.invalidateQueries({ queryKey: configKey(id) })
    },
  })
}

export function useInstall() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (hostIds: string[]) => {
      try {
        return await api<InstallResult>(
          hostIds.length === 1
            ? `/api/hosts/${hostIds[0]}/install`
            : "/api/hosts/bulk/install",
          {
            method: "POST",
            body:
              hostIds.length === 1 ? undefined : JSON.stringify({ hostIds }),
          },
        )
      } catch (e) {
        // 422 tetap membawa hasil per host.
        if (e instanceof ApiError && e.status === 422 && e.body)
          return e.body as InstallResult
        throw e
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: HOSTS_KEY }),
  })
}

export function useCsvImport() {
  return useMutation({
    mutationFn: (v: { csv: string; hostIds: string[] }) =>
      api<{ rows: CsvRowResult[]; valid: number; invalid: number }>(
        "/api/credentials/import",
        {
          method: "POST",
          body: JSON.stringify(v),
        },
      ),
  })
}
