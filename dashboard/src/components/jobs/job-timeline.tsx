"use client"

import { Badge } from "@/components/ui/badge"
import { StatusPill } from "@/components/status-pill"
import { useNow } from "@/hooks/use-now"
import {
  formatClock,
  formatDuration,
  JOB_STATUS_LABEL,
  jobTimeline,
} from "@/lib/jobs"
import type { JobSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Timeline horizontal Booting → Installing → Configuring → Done/Failed (SPEC §4). Tahap yang
 * tercapai = pill pastel (`StatusPill`, satu-satunya pemakai warna tahap); belum tercapai = pill
 * netral hairline. Di bawah pill: waktu (mono) dan lama di tahap itu.
 */
export function JobTimeline({ job }: { job: JobSummary }) {
  const now = useNow()
  const steps = jobTimeline(job, now)
  return (
    <ol
      aria-label="Timeline tahap job"
      data-testid="job-timeline"
      className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4"
    >
      {steps.map((s, i) => (
        <li
          key={s.stage}
          data-testid="timeline-step"
          data-stage={s.stage}
          data-reached={s.reached}
          aria-current={s.current ? "step" : undefined}
          className="relative flex min-w-0 flex-col gap-1.5"
        >
          <div className="flex items-center gap-2">
            {s.reached ? (
              <StatusPill status={s.stage} />
            ) : (
              <Badge
                variant="outline"
                className="h-6 bg-card px-2.5 font-medium text-muted-foreground"
              >
                {JOB_STATUS_LABEL[s.stage]}
              </Badge>
            )}
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "hidden h-px flex-1 sm:block",
                  steps[i + 1].reached ? "bg-hairline-strong" : "bg-border",
                )}
              />
            )}
          </div>
          <span
            className="type-data text-foreground"
            data-testid="timeline-time"
          >
            {s.at ? formatClock(s.at) : <span className="text-muted-soft">—</span>}
          </span>
          {s.durationMs !== null && (
            <span className="type-caption text-muted-foreground">
              {s.current ? "berjalan " : ""}
              <span className="type-data text-xs">
                {formatDuration(s.durationMs)}
              </span>
            </span>
          )}
          {s.current && <span className="sr-only">(tahap saat ini)</span>}
        </li>
      ))}
    </ol>
  )
}
