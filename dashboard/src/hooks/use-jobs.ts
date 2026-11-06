"use client"

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query"

import { syncServerClock } from "@/hooks/use-now"
import { useSettings } from "@/hooks/use-settings"
import { ApiError, apiFetch, errorFromResponse } from "@/lib/api-client"
import { failureReasonText, isFinalJob, mergeJobsHead } from "@/lib/jobs"
import type { JobStatus, JobSummary, JobsResponse } from "@/lib/types"

export const JOBS_KEY = ["jobs"] as const
/** DEC-014 §5: daftar job diperbarui dengan polling 5 detik. */
export const JOBS_POLL_MS = 5_000
export const JOBS_PAGE_SIZE = 50

export const jobKey = (id: string) => ["jobs", "detail", id] as const

/** Error API job (turunan `ApiError` M6 → kebijakan 401/429 bersama berlaku). */
export class JobsApiError extends ApiError {
  constructor(message: string, status: number, retryAfterSec?: number) {
    super(message, status, [], undefined, retryAfterSec)
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url, { cache: "no-store" }).catch((e: unknown) => {
    // Request ditahan lokal (sesi habis / jeda rate limit) → bentuk error job yang sama.
    if (e instanceof ApiError) throw new JobsApiError(e.message, e.status, e.retryAfterSec)
    throw e
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const e = errorFromResponse(res, body)
    throw new JobsApiError(e.message, e.status, e.retryAfterSec)
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
 * Daftar job (terbaru dulu) dengan paginasi cursor opak `before` (`nextBefore`), polling 5 dtk.
 * CR-5-4 (M6): polling hanya meminta HALAMAN PERTAMA (query "head") lalu menggabungkannya ke
 * halaman yang sudah dimuat (`mergeJobsHead`) — halaman lama tidak di-refetch tiap 5 dtk.
 * Status error/fetching gabungan daftar + head.
 */
export function useJobs(filter: JobsFilter) {
  const qc = useQueryClient()
  const f = { hostId: filter.hostId ?? null, status: filter.status ?? null }
  const listKey = [...JOBS_KEY, "list", f] as const
  const list = useInfiniteQuery({
    queryKey: listKey,
    queryFn: async ({ pageParam }) => {
      const data = await getJson<JobsResponse>(jobsUrl({ ...f, before: pageParam }))
      syncServerClock(data.serverTime)
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
  })
  const head = useQuery({
    queryKey: [...JOBS_KEY, "head", f],
    queryFn: async () => {
      const st = qc.getQueryState<InfiniteData<JobsResponse, string | null>>(listKey)
      // Daftar baru saja dimuat (mount / ganti filter / invalidasi) → tidak perlu request kedua.
      if (st?.data && Date.now() - st.dataUpdatedAt < JOBS_POLL_MS / 2) return st.data.pages[0]
      const page = await getJson<JobsResponse>(jobsUrl(f))
      syncServerClock(page.serverTime)
      qc.setQueryData<InfiniteData<JobsResponse, string | null>>(listKey, (old) =>
        mergeJobsHead(old, page),
      )
      return page
    },
    enabled: list.isSuccess,
    refetchInterval: JOBS_POLL_MS,
    refetchIntervalInBackground: false,
  })
  const headError = head.isError && !head.isFetching ? head.error : null
  // Hasil TanStack punya getter tanpa setter → objek baru (spread), bukan mutasi.
  return {
    ...list,
    isError: list.isError || headError !== null,
    error: list.error ?? headError,
    isFetching: list.isFetching || head.isFetching,
  }
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
