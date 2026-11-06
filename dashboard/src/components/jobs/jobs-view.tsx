"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { JobDetail } from "@/components/jobs/job-detail"
import { JobHostFilter, JobStatusFilter } from "@/components/jobs/jobs-filters"
import { JobsTable } from "@/components/jobs/jobs-table"
import { useHosts } from "@/hooks/use-hosts"
import { useJobs } from "@/hooks/use-jobs"
import { jobsHref } from "@/lib/jobs"
import { JOB_STATUSES, type JobStatus, type JobSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

const EMPTY: JobSummary[] = []
const HOST_ID_RE = /^[0-9a-f]{12}$/

function parseStatus(v: string | null): JobStatus | null {
  return v && (JOB_STATUSES as readonly string[]).includes(v) ? (v as JobStatus) : null
}

/**
 * Halaman Provisioning Jobs (M5-T8, plan §2.8): master-detail dengan state di URL
 * `/jobs?host=<id>&status=<s>&job=<id>`. Daftar polling 5 dtk; detail = timeline + log SSE.
 * Bila `?host=` aktif tanpa `?job=`, job terbaru host itu dipilih otomatis.
 */
export function JobsView() {
  const router = useRouter()
  const params = useSearchParams()
  const rawHost = params.get("host")?.toLowerCase() ?? null
  const hostId = rawHost && HOST_ID_RE.test(rawHost) ? rawHost : null
  const status = parseStatus(params.get("status"))
  const jobParam = params.get("job")

  const jobsQuery = useJobs({ hostId, status })
  const pages = jobsQuery.data?.pages
  const jobs = React.useMemo(
    () => (pages ? pages.flatMap((p) => p.jobs) : EMPTY),
    [pages],
  )
  const selectedId = jobParam ?? (hostId ? (jobs[0]?.id ?? null) : null)
  const selected = jobs.find((j) => j.id === selectedId)

  const hosts = useHosts().data?.hosts
  const host = hostId ? hosts?.find((h) => h.id === hostId) : undefined
  const hostName =
    host?.hostname ??
    host?.mac ??
    jobs[0]?.host?.hostname ??
    jobs[0]?.host?.mac ??
    hostId

  const filtered = Boolean(hostId || status)

  function navigate(p: { host?: string | null; status?: string | null; job?: string | null }) {
    router.replace(
      jobsHref({ host: hostId, status, job: jobParam, ...p }),
      { scroll: false },
    )
  }

  const noJobsAtAll =
    !jobsQuery.isPending && !jobsQuery.isError && jobs.length === 0 && !filtered

  return (
    <div className="flex flex-col gap-4" data-testid="jobs-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <JobHostFilter value={hostId} onChange={(h) => navigate({ host: h, job: null })} />
          <JobStatusFilter value={status} onChange={(s) => navigate({ status: s, job: null })} />
          {filtered && (
            <Button
              variant="ghost"
              className="h-9"
              onClick={() => router.replace("/jobs", { scroll: false })}
            >
              Reset filter
            </Button>
          )}
        </div>
        <div className="type-caption flex items-center gap-2 text-muted-foreground">
          {jobsQuery.isFetching ? (
            <Spinner className="size-3.5" />
          ) : (
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                jobsQuery.isError ? "bg-destructive" : "bg-success",
              )}
            />
          )}
          <span>live, tiap 5 detik</span>
        </div>
      </div>

      {rawHost && !hostId && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Parameter host tidak valid</AlertTitle>
          <AlertDescription>
            <span className="type-data">{rawHost}</span> bukan id host (12 digit hex). Menampilkan
            semua host.
          </AlertDescription>
        </Alert>
      )}

      {jobsQuery.isError && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Gagal memuat job</AlertTitle>
          <AlertDescription>
            {jobsQuery.error?.message}. Dashboard akan mencoba lagi otomatis.
          </AlertDescription>
        </Alert>
      )}

      {hostId && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="jobs-history-header">
          <h2 className="type-section-title">
            Riwayat <span className="font-mono tracking-normal">{hostName}</span>
          </h2>
          <span className="type-caption text-muted-foreground" data-testid="jobs-history-count">
            <span className="type-data text-xs">
              {jobs.length}
              {jobsQuery.hasNextPage ? "+" : ""}
            </span>{" "}
            job
          </span>
        </div>
      )}

      {noJobsAtAll ? (
        <Empty
          data-testid="jobs-empty"
          className="rounded-xl border border-dashed border-border bg-canvas-soft py-16"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={WorkflowSquare01Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>Belum ada job</EmptyTitle>
            <EmptyDescription>
              Job dibuat saat Install OS dijalankan dari halaman Hosts.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" asChild>
              <Link href="/hosts">Buka Hosts</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <JobsTable
                jobs={jobs}
                loading={jobsQuery.isPending}
                selectedId={selectedId}
                onSelect={(id) => navigate({ job: id })}
                empty={
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-body">Tidak ada job yang cocok dengan filter.</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.replace("/jobs", { scroll: false })}
                    >
                      Reset filter
                    </Button>
                  </div>
                }
              />
            </div>
            {jobsQuery.hasNextPage && (
              <Button
                variant="outline"
                className="self-center"
                data-testid="jobs-load-more"
                disabled={jobsQuery.isFetchingNextPage}
                onClick={() => jobsQuery.fetchNextPage()}
              >
                {jobsQuery.isFetchingNextPage && <Spinner data-icon="inline-start" />}
                Muat job lebih lama
              </Button>
            )}
          </div>
          <div className="min-w-0">
            {selectedId ? (
              <JobDetail key={selectedId} jobId={selectedId} initial={selected} />
            ) : (
              <Empty className="rounded-xl border border-dashed border-border bg-canvas-soft py-16">
                <EmptyHeader>
                  <EmptyTitle>Pilih job</EmptyTitle>
                  <EmptyDescription>
                    Pilih job di daftar untuk melihat timeline tahap dan log instalasinya.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
