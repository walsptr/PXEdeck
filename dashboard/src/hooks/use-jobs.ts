"use client"

import { useInfiniteQuery, useQuery } from "@tanstack/react-query"

import { syncServerClock } from "@/hooks/use-now"
import { useSettings } from "@/hooks/use-settings"
import { failureReasonText, isFinalJob } from "@/lib/jobs"
import type { JobStatus, JobSummary, JobsResponse } from "@/lib/types"

export const JOBS_KEY = ["jobs"] as const
/** DEC-014 §5: daftar job diperbarui dengan polling 5 detik. */
export const JOBS_POLL_MS = 5_000
export const JOBS_PAGE_SIZE = 50

export const jobKey = (id: string) => ["jobs", "detail", id] as const

export class JobsApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new JobsApiError(
      body?.error ?? `${res.status} ${res.statusText}`,
      res.status,
    )
  }
  return (await res.json()) as T
}

export type JobsFilter = { hostId?: string | null; status?: JobStatus | null }

export function jobsUrl(
  f: JobsFilter & { before?: string | null; limit?: number },
): string {
  const q = new URLSearchParams()
  if (f.hostId) q.set("hostId", f.hostId)
  if (f.status) q.set("status", f.status)
  q.set("limit", String(f.limit ?? JOBS_PAGE_SIZE))
  if (f.before) q.set("before", f.before)
  return `/api/jobs?${q}`
}

/**
 * Daftar job (terbaru dulu) dengan paginasi cursor `before` (`nextBefore`), polling 5 dtk.
 * Polling memuat ulang semua halaman yang sudah dibuka.
 */
export function useJobs(filter: JobsFilter) {
  return useInfiniteQuery({
    queryKey: [
      ...JOBS_KEY,
      "list",
      { hostId: filter.hostId ?? null, status: filter.status ?? null },
    ],
    queryFn: async ({ pageParam }) => {
      const data = await getJson<JobsResponse>(
        jobsUrl({ ...filter, before: pageParam }),
      )
      syncServerClock(data.serverTime)
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    refetchInterval: JOBS_POLL_MS,
    refetchIntervalInBackground: false,
  })
}

/** Detail job; polling 5 dtk selama job aktif (event `stage` SSE juga memperbaruinya). */
export function useJob(id: string | null) {
  return useQuery({
    queryKey: jobKey(id ?? ""),
    queryFn: () => getJson<JobSummary>(`/api/jobs/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const d = q.state.data
      if (q.state.error instanceof JobsApiError && q.state.error.status === 404)
        return false
      return d && isFinalJob(d.status) ? false : JOBS_POLL_MS
    },
    retry: (n, e) => !(e instanceof JobsApiError && e.status < 500) && n < 2,
  })
}

/**
 * Teks alasan gagal job dengan N dari settings server, mis. "Timeout di tahap Installing
 * (> 15 mnt)" (cache settings dipakai bersama halaman Settings).
 */
export function useFailureText() {
  const s = useSettings().data
  return (reason: string | null | undefined) =>
    failureReasonText(reason, {
      timeouts: s?.jobTimeouts,
      maxInstallerBoots: s?.maxInstallerBoots,
    })
}
