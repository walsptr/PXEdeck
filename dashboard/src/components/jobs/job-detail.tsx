"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/status-pill"
import { JobTimeline } from "@/components/jobs/job-timeline"
import { LogViewer } from "@/components/jobs/log-viewer"
import { JobsApiError, useFailureText, useJob } from "@/hooks/use-jobs"
import { useOsLabel } from "@/hooks/use-os-images"
import { useSettings } from "@/hooks/use-settings"
import { formatClock } from "@/lib/jobs"
import { formatDateTime } from "@/lib/format"
import type { JobSummary } from "@/lib/types"

export function JobDetail({ jobId, initial }: { jobId: string; initial?: JobSummary }) {
  const q = useJob(jobId)
  const job = q.data ?? initial
  if (!job) {
    if (q.isError) {
      return (
        <Alert variant="destructive" data-testid="job-detail-error">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>
            {q.error instanceof JobsApiError && q.error.status === 404
              ? "Job tidak ditemukan"
              : "Gagal memuat job"}
          </AlertTitle>
          <AlertDescription>{q.error.message}</AlertDescription>
        </Alert>
      )
    }
    return <Skeleton className="h-96 w-full rounded-xl" />
  }
  return <JobDetailCard job={job} />
}

function JobDetailCard({ job }: { job: JobSummary }) {
  const failureText = useFailureText()
  const osLabel = useOsLabel()
  const maxBoots = useSettings().data?.maxInstallerBoots
  const name = job.host?.hostname ?? job.host?.mac ?? job.hostId
  const reason = failureText(job.failureReason)

  return (
    <Card data-testid="job-detail" data-job-id={job.id}>
      <CardHeader>
        <CardTitle className="type-section-title flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Job <span className="font-mono tracking-normal">{name}</span>
          </span>
          <StatusPill status={job.status} />
        </CardTitle>
        <CardDescription className="type-caption flex flex-wrap gap-x-3 gap-y-1">
          {job.host?.hostname && <span className="type-data">{job.host.mac}</span>}
          <span>{osLabel(job.osImageId)}</span>
          <span>
            dibuat{" "}
            <time dateTime={job.createdAt} className="type-data text-xs">
              {formatDateTime(job.createdAt)}
            </time>
          </span>
          <span className="type-data text-xs" title="ID job">
            {job.id}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <JobTimeline job={job} />
        {job.status === "failed" && (
          <p
            data-testid="job-failure-reason"
            data-reason={job.failureReason ?? ""}
            className="type-body text-destructive"
          >
            <span className="font-medium">Gagal:</span>{" "}
            {reason ?? "alasan tidak tercatat"}
            {job.finishedAt && (
              <span className="type-caption text-muted-foreground">
                {" "}
                · <span className="type-data text-xs">{formatClock(job.finishedAt)}</span>
              </span>
            )}
          </p>
        )}
        <dl className="type-caption flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
          <div className="flex gap-1.5">
            <dt>Installer dilayani</dt>
            <dd data-testid="job-installer-boots" className="type-data text-xs text-foreground">
              {job.installerBoots}
              {maxBoots ? `/${maxBoots}` : ""}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Event</dt>
            <dd className="type-data text-xs text-foreground">{job.eventCount}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Host</dt>
            <dd>
              <Link
                href={`/hosts?q=${encodeURIComponent(job.host?.mac ?? "")}`}
                className="type-data text-xs text-foreground underline-offset-4 hover:underline"
              >
                {job.host?.mac ?? job.hostId}
              </Link>
            </dd>
          </div>
        </dl>
        <Separator />
        <LogViewer key={job.id} jobId={job.id} />
      </CardContent>
    </Card>
  )
}
